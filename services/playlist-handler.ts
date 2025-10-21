import HLS from 'hls-parser';
import axios from 'axios';
import _ from 'lodash';

import {userAgent} from './user-agent';
import {IHeaders, THeaderInfo} from './shared-interfaces';
import {cacheLayer, promiseCache} from './caching';
import {proxySegments} from './misc-db-service';

const isRelativeUrl = (url?: string): boolean => (url?.startsWith('http') ? false : true);
const cleanUrl = (url: string): string => url.replace(/(\[.*\])/gm, '').replace(/(?<!:)\/\//gm, '/');
const createBaseUrl = (url: string): string => {
  const cleaned = url.replace(/\.m3u8.*$/, '');
  return cleaned.substring(0, cleaned.lastIndexOf('/') + 1);
};
const createBaseUrlChunklist = (url: string, network: string): string => {
  const cleaned = url.replace(/\.m3u8.*$/, '');
  let filteredUrl: string[] | string = cleaned.split('/');

  if ((network === 'foxsports' || network === 'foxone') && !url.includes('akamai')) {
  filteredUrl = filteredUrl.filter(seg => !seg.match(/=/));
  }

  filteredUrl = filteredUrl.join('/');
  return filteredUrl.substring(0, filteredUrl.lastIndexOf('/') + 1);
};
const usesHostRoot = (url: string): boolean => url.startsWith('/');
const convertHostUrl = (url: string, fullUrl: string): string => {
  const uri = new URL(fullUrl);

  return `${uri.origin}${url}`;
};
const isBase64Uri = (url: string) => url.indexOf('base64') > -1 || url.startsWith('data');

const reTarget = /#EXT-X-TARGETDURATION:([0-9]+)/;
const reAudioTrack = /#EXT-X-MEDIA:TYPE=AUDIO.*URI="([^"]+)"/gm;
const reMap = /#EXT-X-MAP:URI="([^"]+)"/gm;
const reSubMap = /#EXT-X-MEDIA:TYPE=SUBTITLES.*URI="([^"]+)"/gm;
const reSubMapVictory = /#EXT-X-MEDIA:.*TYPE=SUBTITLES.*URI="([^"]+)"/gm;
const reVersion = /#EXT-X-VERSION:(\d+)/;

const updateVersion = (playlist: string): string =>
  playlist.replace(reVersion, (match, currentVersion) => {
    const numericValue = +currentVersion;
    const newVersion = numericValue < 5 ? 5 : numericValue;
    return `#EXT-X-VERSION:${newVersion}`;
  });

const getTargetDuration = (chunklist: string, divide = true): number => {
  let targetDuration = 2;

  const tester = reTarget.exec(chunklist);

  if (tester && tester[1]) {
    targetDuration = divide ? Math.floor(parseInt(tester[1], 10) / 2) : parseInt(tester[1], 10);

    if (!_.isNumber(targetDuration) || _.isNaN(targetDuration)) {
      targetDuration = 2;
    }
  }

  return targetDuration;
};

const handleDateranges = (playlist: string, network: string): string => {
  // Regular expression to match #EXT-X-DATERANGE tags
  const daterangeRegex = /#EXT-X-DATERANGE:(.*?)(\r?\n|$)/g;
  const dateranges: {
    start: number;
    end: number;
    class: string;
    params: Record<string, string>;
    index: number;
    length: number;
    ending: string;
    original: string;
  }[] = [];
  let match: RegExpExecArray | null;

  // Parse all DATERANGE tags
  while ((match = daterangeRegex.exec(playlist)) !== null) {
    const tagContent = match[1];
    const original = match[0];
    const ending = match[2];

    // Parse tag attributes
    const params = tagContent.split(',').reduce((acc, param) => {
      const [key, value] = param.split('=');
      if (key && value) {
        acc[key.trim()] = value.trim().replace(/^"|"$/g, '');
      }
      return acc;
    }, {} as Record<string, string>);

    // Add CLASS if missing, only for foxone network
    if (network === 'foxone' && !params['CLASS'] && params['ID']) {
      params['CLASS'] = params['ID'];
    }

    // Validate required attributes
    const startStr = params['START-DATE'] || params['START'];
    const endStr = params['END-DATE'] || params['END'];
    const durationStr = params['DURATION'];
    const classValue = params['CLASS'] || 'no-class'; // Fallback if still no CLASS

    // Parse START, END, and DURATION
    let start: number, end: number;
    try {
      if (startStr) {
        // Handle ISO 8601 timestamps or numeric
        start = startStr.includes('T')
          ? new Date(startStr).getTime() / 1000
          : parseFloat(startStr);

        if (isNaN(start)) {
          console.warn(`Skipping invalid DATERANGE with invalid START: ${tagContent}`);
          continue;
        }

        // Determine END
        if (endStr) {
          end = endStr.includes('T')
            ? new Date(endStr).getTime() / 1000
            : parseFloat(endStr);
        } else if (durationStr) {
          const duration = parseFloat(durationStr);
          end = isNaN(duration) ? NaN : start + duration;
        } else {
          // Treat as point event if no END or DURATION
          end = start;
        }

        if (isNaN(end) || start > end) {
          console.warn(`Skipping invalid DATERANGE: start=${startStr}, end=${endStr}, duration=${durationStr}, class=${classValue}`);
          continue;
        }

        dateranges.push({
          start,
          end,
          class: classValue,
          params,
          index: match.index,
          length: original.length,
          ending,
          original,
        });
      } else {
        console.warn(`Skipping DATERANGE with missing START attribute: ${tagContent}`);
      }
    } catch (e) {
      console.error(`Error parsing DATERANGE: ${tagContent}`, e);
    }
  }

  // Log parsed DATERANGE tags for debugging
  // console.log(`Found ${dateranges.length} DATERANGE tags`);

  // Group by CLASS
  const groups: Record<string, typeof dateranges[0][]> = {};
  dateranges.forEach(d => {
    if (!groups[d.class]) {
      groups[d.class] = [];
    }
    groups[d.class].push(d);
  });

  // Process each group to merge overlaps
  const replacements: { pos: number; len: number; newStr: string }[] = [];

  Object.values(groups).forEach(group => {
    if (group.length === 0) return;

    // Sort by start time
    group.sort((a, b) => a.start - b.start);

    // Log group details
    // console.log(`Processing group with CLASS="${group[0].class}", count=${group.length}`);
    // group.forEach(d =>
    //   console.log(
    //     `  DATERANGE: start=${d.start}, end=${d.end}, params=${JSON.stringify(d.params)}`
    //   )
    // );

    // Merge overlapping ranges
    const merged: typeof group[0][] = [];
    let current = { ...group[0] };

    for (let i = 1; i < group.length; i++) {
      const next = group[i];
      // Consider ranges overlapping if current.end >= next.start (with epsilon for floating-point)
      const epsilon = 0.001;
      if (current.end + epsilon >= next.start) {
        // Overlap: extend to max end time
        current.end = Math.max(current.end, next.end);
        // Merge attributes, prioritizing the first tag's non-time attributes
        current.params = { ...next.params, ...current.params }; // Prioritize first tag's attributes
        // console.warn(
        //   `Merged overlap in DATERANGE with CLASS="${current.class}": ${current.start}-${current.end}`
        // );
      } else {
        merged.push(current);
        current = { ...next };
      }
    }
    merged.push(current);

    // Generate replacement tags
    merged.forEach(m => {
      // Update time-related attributes based on original keys
      if (m.params['START-DATE']) {
        m.params['START-DATE'] = new Date(m.start * 1000).toISOString();
      } else if (m.params['START']) {
        m.params['START'] = m.start.toString();
      }

      if (m.params['END-DATE']) {
        m.params['END-DATE'] = new Date(m.end * 1000).toISOString();
      } else if (m.params['END']) {
        m.params['END'] = m.end.toString();
      } else if (m.params['DURATION']) {
        m.params['DURATION'] = (m.end - m.start).toString();
      }
      // If it was a point event (no END/DURATION originally), don't add them

      const newTagContent = Object.entries(m.params)
        .map(([k, v]) => {
          if (k === 'SCTE35-CMD' || k === 'SCTE35-OUT' || k === 'SCTE35-IN') {
            return `${k}=${v}`;
          } else {
            return `${k}="${v}"`;
          }
        })
        .join(',');
      const newStr = `#EXT-X-DATERANGE:${newTagContent}${m.ending}`;
      replacements.push({ pos: m.index, len: m.length, newStr });
    });

    // Remove original tags that were merged away
    const keptPositions = new Set(merged.map(m => m.index));
    group.forEach(d => {
      if (!keptPositions.has(d.index)) {
        replacements.push({ pos: d.index, len: d.length, newStr: '' });
      }
    });
  });

  // Apply replacements in reverse order to avoid index shifts
  replacements.sort((a, b) => b.pos - a.pos);
  let updatedPlaylist = playlist;
  replacements.forEach(r => {
    updatedPlaylist = updatedPlaylist.slice(0, r.pos) + r.newStr + updatedPlaylist.slice(r.pos + r.len);
  });

  // Log final playlist for debugging
  // console.log('Updated playlist DATERANGE tags:');
  const finalMatches = updatedPlaylist.match(daterangeRegex) || [];
  // finalMatches.forEach(m => console.log(m));

  return updatedPlaylist;
};

const parseReplacementUrl = (url: string, manifestUrl: string): string =>
  isRelativeUrl(url)
    ? usesHostRoot(url)
      ? convertHostUrl(url, manifestUrl)
      : cleanUrl(`${createBaseUrl(manifestUrl)}/${url}`)
    : url;

export class PlaylistHandler {
  public playlist: string;

  private baseUrl: string;
  private baseProxyUrl: string;
  private headers: THeaderInfo;
  private overlayCookies?: string[];
  private currentHeaders?: IHeaders;
  private channel: string;
  private segmentDuration: number;
  private network: string;
  private eventId: string | number;

  constructor(headers: THeaderInfo, appUrl: string, channel: string, network: string, eventId: string | number) {
    this.headers = headers;
    this.channel = channel;
    this.baseUrl = `${appUrl}/channels/${channel}/`;
    this.baseProxyUrl = `${appUrl}/chunklist/${channel}/`;
    this.network = network;
    this.eventId = eventId;
  }

  public async initialize(manifestUrl: string): Promise<void> {
    const headers = await this.getHeaders();
    await this.parseManifest(manifestUrl, headers);
  }

  public async getSegmentOrKey(segmentId: string): Promise<ArrayBuffer> {
    try {
      const headers = await this.getHeaders();
      return cacheLayer.getDataFromSegment(segmentId, headers);
    } catch (e) {
      console.error(e);
    }
  }

  public async parseManifest(manifestUrl: string, headers: IHeaders): Promise<void> {
    try {
      const {
        data: manifest,
        request,
        headers: resHeaders,
      } = await axios.get<string>(manifestUrl, {
        headers: {
          'Accept-Encoding': 'identity',
          'User-Agent': userAgent,
          ...headers,
        },
      });

      // Preprocess manifest only for foxone to handle DATERANGE tags before parsing
      const processedManifest = this.network === 'foxone' ? handleDateranges(manifest, this.network) : manifest;

      if (resHeaders['set-cookie']) {
        this.overlayCookies = resHeaders['set-cookie'];
      }

      const realManifestUrl = request.res.responseUrl;

      let urlParams = '';
      if (this.network === 'foxsports' || this.network === 'foxone') {
      try {
        urlParams = new URL(realManifestUrl).search;
          } catch (error) {
          console.error('Invalid URL provided:', error);
        urlParams = ''; // Fallback to an empty string on error
      }
}
      const playlist = HLS.parse(manifest);

      /** Sort playlist so highest resolution is first in list (Emby workaround) */
      playlist.variants?.sort((v1, v2) => {
        if (v1.bandwidth > v2.bandwidth) {
          return -1;
        }

        if (v1.bandwidth < v2.bandwidth) {
          return 1;
        }

        return 0;
      });

      const clonedManifest = updateVersion(HLS.stringify(playlist));
      let updatedManifest = clonedManifest;

      if (this.network === 'victory' || this.network === 'bally') {
        const subTracks = [...manifest.matchAll(reSubMapVictory)];
        subTracks.forEach(track => {
          if (track && track[1]) {
            const fullChunklistUrl = parseReplacementUrl(track[1], realManifestUrl);

            const chunklistName = cacheLayer.getChunklistFromUrl(`${fullChunklistUrl}${urlParams}`);
            updatedManifest = updatedManifest.replace(track[1], `${this.baseProxyUrl}${chunklistName}.m3u8`);
          }
        });
      } else if (! (this.network == 'foxsports' || this.network === 'foxone')) {
        const audioTracks = [...manifest.matchAll(reAudioTrack)];
        audioTracks.forEach(track => {
          if (track && track[1]) {
            const fullChunklistUrl = parseReplacementUrl(track[1], realManifestUrl);

            const chunklistName = cacheLayer.getChunklistFromUrl(`${fullChunklistUrl}${urlParams}`);
            updatedManifest = updatedManifest.replace(track[1], `${this.baseProxyUrl}${chunklistName}.m3u8`);
          }
        });

        const subTracks = [...manifest.matchAll(reSubMap)];
        subTracks.forEach(track => {
          if (track && track[1]) {
            const fullChunklistUrl = parseReplacementUrl(track[1], realManifestUrl);

            const chunklistName = cacheLayer.getChunklistFromUrl(`${fullChunklistUrl}${urlParams}`);
            updatedManifest = updatedManifest.replace(track[1], `${this.baseProxyUrl}${chunklistName}.m3u8`);
          }
        });
      }

      playlist.variants?.forEach(variant => {
        const fullChunklistUrl = parseReplacementUrl(variant.uri, realManifestUrl);

        const chunklistName = cacheLayer.getChunklistFromUrl(`${fullChunklistUrl}${urlParams}`);
        updatedManifest = updatedManifest.replace(variant.uri, `${this.baseProxyUrl}${chunklistName}.m3u8`);
      });

      this.playlist = updatedManifest;
      //this.playlist = handleDateranges(this.playlist, this.network);
    } catch (e) {
      console.error(e);
      console.log('Could not parse M3U8 properly!');
    }
  }

  public cacheChunklist(chunklistId: string): Promise<string> {
    if (this.segmentDuration) {
      return promiseCache.getPromise(chunklistId, this.proxyChunklist(chunklistId), this.segmentDuration * 1000);
    }

    return this.proxyChunklist(chunklistId);
  }

  private async proxyChunklist(chunkListId: string): Promise<string> {
    const proxyAllSegments = await proxySegments();

    try {
      const url = cacheLayer.getChunklistFromId(chunkListId);
      const headers = await this.getHeaders();

      const {data: chunkList, request} = await axios.get<string>(url, {
        headers: {
          'Accept-Encoding': 'identity',
          'User-Agent': userAgent,
          ...headers,
        },
      });

      // Preprocess chunklist only for foxone to handle DATERANGE tags before parsing
      const processedChunklist = this.network === 'foxone' ? handleDateranges(chunkList, this.network) : chunkList;

      const realChunklistUrl = request.res.responseUrl;
      const baseManifestUrl = cleanUrl(createBaseUrlChunklist(realChunklistUrl, this.network));
      const keys = new Set<string>();

      //const clonedChunklist = updateVersion(chunkList);
      const clonedChunklist = updateVersion(processedChunklist);
      let updatedChunkList = clonedChunklist;

      const chunks = HLS.parse(clonedChunklist);

      const shouldProxy =
        proxyAllSegments || baseManifestUrl.includes('akamai') || this.network === 'mlbtv' || this.network === 'gotham';

      chunks.segments.forEach(segment => {
        const segmentUrl = segment.uri;
        const segmentKey = segment.key?.uri;

        const fullSegmentUrl = isRelativeUrl(segmentUrl)
          ? usesHostRoot(segmentUrl)
            ? convertHostUrl(segmentUrl, baseManifestUrl)
            : cleanUrl(`${baseManifestUrl}${segmentUrl}`)
          : segmentUrl;

        if (
          shouldProxy &&
          // Proxy keyed segments
          (segmentKey ||
            // Proxy non-keyed segments that aren't on ESPN
            (!segmentKey && this.network !== 'espn')) &&
          // Just until I figure out a workaround
          !segmentUrl.endsWith('mp4')
        ) {
          const segmentName = cacheLayer.getSegmentFromUrl(fullSegmentUrl, `${this.channel}-segment`);
          updatedChunkList = updatedChunkList.replace(segmentUrl, `${this.baseUrl}${segmentName}.ts`);
        } else {
          updatedChunkList = updatedChunkList.replace(segmentUrl, fullSegmentUrl);
        }

        if (segmentKey && !isBase64Uri(segmentKey)) {
          keys.add(segmentKey);
        }
      });

      if (!this.segmentDuration) {
        this.segmentDuration = getTargetDuration(chunkList);
      }

      keys.forEach(key => {
        const fullKeyUrl = isRelativeUrl(key)
          ? usesHostRoot(key)
            ? convertHostUrl(key, baseManifestUrl)
            : cleanUrl(`${baseManifestUrl}${key}`)
          : key;

        const keyName = cacheLayer.getSegmentFromUrl(fullKeyUrl, `${this.channel}-key`);

        while (updatedChunkList.indexOf(key) > -1) {
          updatedChunkList = updatedChunkList.replace(key, `${this.baseUrl}${keyName}.key`);
        }
      });

      const xMaps = [...updatedChunkList.matchAll(reMap)];

      xMaps.forEach(xmap => {
        if (xmap && xmap[1]) {
          const fullMapUrl = isRelativeUrl(xmap[1])
            ? usesHostRoot(xmap[1])
              ? convertHostUrl(xmap[1], baseManifestUrl)
              : cleanUrl(`${baseManifestUrl}${xmap[1]}`)
            : xmap[1];

          if (shouldProxy) {
            const m4iName = cacheLayer.getSegmentFromUrl(fullMapUrl, `${this.channel}-m4i`);
            updatedChunkList = updatedChunkList.replace(xmap[1], `${this.baseUrl}${m4iName}.m4i`);
          } else {
            updatedChunkList = updatedChunkList.replace(xmap[1], fullMapUrl);
          }
        }
      });

      return updatedChunkList;
    } catch (e) {
      console.error(e);
      console.log('Could not parse chunklist properly!');
    }
  }

  private async getHeaders(): Promise<IHeaders> {
    let headers: IHeaders = {};

    if (_.isFunction(this.headers)) {
      headers = await this.headers(this.eventId, this.currentHeaders);
    } else {
      headers = _.cloneDeep(this.headers);
    }

    this.currentHeaders = _.cloneDeep(headers);

    if (this.overlayCookies) {
      if (headers.Cookie) {
        headers.Cookie = [
          ...new Set([...(_.isArray(headers.Cookie) ? headers.Cookie : [`${headers.Cookie}`]), ...this.overlayCookies]),
        ];
      } else {
        headers.Cookie = this.overlayCookies;
      }
    }

    return headers;
  }
}
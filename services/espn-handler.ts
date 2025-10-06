import fs from 'fs';
import https from 'https';
import fsExtra from 'fs-extra';
import path from 'path';
import axios from 'axios';
import Sockette from 'sockette';
import ws from 'ws';
import jwt_decode from 'jwt-decode';
import _ from 'lodash';
import url from 'url';
import moment from 'moment';

import {userAgent} from './user-agent';
import {configPath} from './config';
import {
  useEspnPlus,
  requiresEspnProvider,
  useAccN,
  useAccNx,
  useEspn1,
  useEspn2,
  useEspn3,
  useEspnU,
  useSec,
  useSecPlus,
  useEspnPpv,
  useEspnews,
} from './networks';
import {IAdobeAuth, willAdobeTokenExpire, createAdobeAuthHeader} from './adobe-helpers';
import {getRandomHex, normalTimeRange} from './shared-helpers';
import {
  ClassTypeWithoutMethods,
  IEntry,
  IHeaders,
  IJWToken,
  IProvider,
  TChannelPlaybackInfo,
} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {usesLinear} from './misc-db-service';

global.WebSocket = ws;

const espnPlusTokens = path.join(configPath, 'espn_plus_tokens.json');
const espnLinearTokens = path.join(configPath, 'espn_linear_tokens.json');

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

// For `watch.graph.api.espn.com` URLs
const instance = axios.create({
  httpsAgent,
});

interface IAuthResources {
  [key: string]: boolean;
}

interface IEndpoint {
  href: string;
  headers: {
    [key: string]: string;
  };
  method: 'POST' | 'GET';
}

interface IAppConfig {
  services: {
    account: {
      client: {
        endpoints: {
          createAccountGrant: IEndpoint;
        };
      };
    };
    token: {
      client: {
        endpoints: {
          exchange: IEndpoint;
        };
      };
    };
    device: {
      client: {
        endpoints: {
          createAccountGrant: IEndpoint;
          createDeviceGrant: IEndpoint;
        };
      };
    };
  };
}

interface IToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface IGrant {
  grant_type: string;
  assertion: string;
}

interface ITokens extends IToken {
  ttl: number;
  refresh_ttl: number;
  swid: string;
  id_token: string;
}

export interface IEspnPlusMeta {
  use_ppv?: boolean;
  hide_studio?: boolean;
  zip_code?: string;
  in_market_teams?: string;
}

export interface IEspnMeta {
  sec_plus?: boolean;
  accnx?: boolean;
  espn3?: boolean;
  espn3isp?: boolean;
}

const ADOBE_KEY = ['g', 'B', '8', 'H', 'Y', 'd', 'E', 'P', 'y', 'e', 'z', 'e', 'Y', 'b', 'R', '1'].join('');

const ADOBE_PUBLIC_KEY = [
  'y',
  'K',
  'p',
  's',
  'H',
  'Y',
  'd',
  '8',
  'T',
  'O',
  'I',
  'T',
  'd',
  'T',
  'M',
  'J',
  'H',
  'm',
  'k',
  'J',
  'O',
  'V',
  'm',
  'g',
  'b',
  'b',
  '2',
  'D',
  'y',
  'k',
  'N',
  'K',
].join('');

const ANDROID_ID = 'ESPN-OTT.GC.ANDTV-PROD';

const DISNEY_ROOT_URL = 'https://registerdisney.go.com/jgc/v6/client';
const API_KEY_URL = '/{id-provider}/api-key?langPref=en-US';
const LICENSE_PLATE_URL = '/{id-provider}/license-plate';
const REFRESH_AUTH_URL = '/{id-provider}/guest/refresh-auth?langPref=en-US';

const BAM_API_KEY = 'ZXNwbiZicm93c2VyJjEuMC4w.ptUt7QxsteaRruuPmGZFaJByOoqKvDP2a5YkInHrc7c';
const BAM_APP_CONFIG =
  'https://bam-sdk-configs.bamgrid.com/bam-sdk/v2.0/espn-a9b93989/browser/v3.4/linux/chrome/prod.json';

const LINEAR_NETWORKS = ['espn1', 'espn2', 'espnu', 'sec', 'acc', 'espnews'];

const urlBuilder = (endpoint: string, provider: string) =>
  `${DISNEY_ROOT_URL}${endpoint}`.replace('{id-provider}', provider);

const isTokenValid = (token?: string): boolean => {
  if (!token) {
    return false;
  }

  try {
    const decoded: IJWToken = jwt_decode(token);
    return new Date().valueOf() / 1000 < decoded.exp;
  } catch (e) {
    return false;
  }
};

const willTokenExpire = (token?: string): boolean => {
  if (!token) {
    return true;
  }

  try {
    const decoded: IJWToken = jwt_decode(token);
    // Will the token expire in the next hour?
    return Math.floor(new Date().valueOf() / 1000) + 3600 > decoded.exp;
  } catch (e) {
    return true;
  }
};

const willTimestampExpire = (timestamp?: number): boolean => {
  if (!timestamp) {
    return true;
  }

  return moment(timestamp).isBefore(moment().add(2, 'hour'));
};

const getApiKey = async (provider: string) => {
  try {
    const {headers} = await axios.post(urlBuilder(API_KEY_URL, provider));
    return headers['api-key'];
  } catch (e) {
    console.error(e);
    console.log('Could not get API key');
  }
};

const fixHeaderKey = (headerVal: string, authToken = '') =>
  headerVal.replace('{apiKey}', BAM_API_KEY).replace('{accessToken}', authToken);

const makeApiCall = async (endpoint: IEndpoint, body: any, authToken = '') => {
  const headers = {};
  let reqBody: any = _.cloneDeep(body);

  Object.entries(endpoint.headers).forEach(([key, value]) => {
    headers[key] = fixHeaderKey(value, authToken);
  });

  if (
    headers['Content-Type'] === 'application/x-www-form-urlencoded' ||
    headers['content-type'] === 'application/x-www-form-urlencoded'
  ) {
    reqBody = new url.URLSearchParams(reqBody).toString();
  }

  if (endpoint.method === 'POST') {
    const {data} = await axios.post(endpoint.href, reqBody, {headers});
    return data;
  } else {
    const {data} = await axios.get(endpoint.href, {headers});
    return data;
  }
};

const getNetworkInfo = (network?: string) => {
  let networks = 'null';
  let packages = '["espn_plus"]';

  if (network === 'espn1') {
    networks = '["e748f3c0-3f7c-3088-a90a-0ccb2588e0ed"]';
    packages = 'null';
  } else if (network === 'espn2') {
    networks = '["017f41a2-ef4f-39d3-9f45-f680b88cd23b"]';
    packages = 'null';
  } else if (network === 'espn3') {
    networks = '["3e99c57a-516c-385d-9c22-2e40aebc7129"]';
    packages = 'null';
  } else if (network === 'espnU') {
    networks = '["500b1f7c-dad5-33f9-907c-87427babe201"]';
    packages = 'null';
  } else if (network === 'secn') {
    networks = '["74459ca3-cf85-381d-b90d-a95ff6e7a207"]';
    packages = 'null';
  } else if (network === 'secnPlus') {
    networks = '["19644d95-cc83-38ed-bdf9-50b9f2e9ebfc"]';
    packages = 'null';
  } else if (network === 'accn') {
    networks = '["76b92674-175c-4ff1-8989-380aa514eb87"]';
    packages = 'null';
  } else if (network === 'accnx') {
    networks = '["9f538e0b-a896-3325-a417-79034e03a248"]';
    packages = 'null';
  } else if (network === 'espnews') {
    networks = '["1e760a1c-c204-339d-8317-8e615c9cc0e0"]';
    packages = 'null';
  } else if (network === 'espn_ppv') {
    networks = '["d41c5aaf-e100-4726-841f-1e453af347f9"]';
    packages = 'null';
  }

  return [networks, packages];
};

class WebSocketPlus {
  public wsToken?: ITokens;
  private wsClient?: Sockette;

  public closeWebSocket = (): void => {
    if (this.wsClient) {
      try {
        this.wsClient.close();
        this.wsClient = undefined;
      } catch (e) {}
    }

    this.wsToken = undefined;
  };

  public initializeWebSocket = (wsUrl: string, licensePlate: any): void => {
    this.closeWebSocket();

    this.wsClient = new Sockette(wsUrl, {
      maxAttempts: 10,
      onerror: e => {
        console.error(e);
        console.log('Could not start authentication for ESPN+');

        this.closeWebSocket();
      },
      onmessage: e => {
        const wsData = JSON.parse(e.data);

        if (wsData.op) {
          if (wsData.op === 'C') {
            this.wsClient.json({
              op: 'S',
              rc: 200,
              sid: wsData.sid,
              tc: licensePlate.data.fastCastTopic,
            });
          } else if (wsData.op === 'P') {
            this.wsToken = JSON.parse(wsData.pl);
          }
        }
      },
      onopen: () => {
        this.wsClient.json({
          op: 'C',
        });
      },
      timeout: 5e3,
    });
  };
}

const wsPlus = new WebSocketPlus();

const authorizedResources: IAuthResources = {};

const parseCategories = event => {
  const categories = ['ESPN'];
  for (const classifier of [event.category, event.subcategory, event.sport, event.league]) {
    if (classifier !== null && classifier.name !== null) {
      categories.push(classifier.name);
    }
  }

  return [...new Set(categories)];
};

const parseAirings = async events => {
  const useLinear = await usesLinear();

  const [now, endSchedule] = normalTimeRange();

  const {meta: plusMeta} = await db.providers.findOneAsync<IProvider<TESPNPlusTokens, IEspnPlusMeta>>({
    name: 'espnplus',
  });

  const in_market_team_filter =
    plusMeta?.in_market_teams && plusMeta?.in_market_teams.length > 0 ? plusMeta?.in_market_teams.split(',') : [];
    
  const in_market_feed_filter =
    plusMeta?.in_market_teams && plusMeta?.in_market_teams.length > 0 ? plusMeta?.in_market_teams.split(',').map(item => {
    const words = item.trim().split(' ');
    return words.length > 0 ? words[words.length - 1] : ''; 
  }) : [];

  for (const event of events) {
    const entryExists = await db.entries.findOneAsync<IEntry>({id: event.id});

    if (!entryExists) {
      const isLinear = useLinear && event.network?.id && LINEAR_NETWORKS.some(n => n === event.network?.id);

      if (!isLinear && plusMeta?.hide_studio && event.program?.isStudio) {
        continue;
      }

      const start = moment(event.startDateTime);
      const end = moment(event.startDateTime).add(event.duration, 'seconds');
      const originalEnd = moment(end);

      if (!isLinear) {
        end.add(1, 'hour');
      }

      if (end.isBefore(now) || start.isAfter(endSchedule)) {
        continue;
      }

      if (event.network?.id === 'bam_dtc' && in_market_team_filter.some(tn => event.name.indexOf(tn) > -1)) {
        const feeds = events.filter((obj) => obj.name === event.name && obj.start === event.start);
        if (feeds.length > 1 || in_market_feed_filter.some(tn => event.feedName.indexOf(tn) > -1)) {
          continue;
        }
      }

      console.log('Adding event: ', event.name);

      await db.entries.insertAsync<IEntry>({
        categories: parseCategories(event),
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        feed: event.feedName,
        from: 'espn',
        id: event.id,
        image: event.image?.url,
        name: event.name,
        network: event.network?.name || 'ESPN+',
        sport: event.subcategory?.name,
        start: start.valueOf(),
        url: event.source?.url,
        ...(isLinear && {
          channel: event.network?.id,
          linear: true,
        }),
        originalEnd: originalEnd.valueOf(),
      });
    }
  }
};

const isEnabled = async (which?: string): Promise<boolean> => {
  const {enabled: espnPlusEnabled, meta: plusMeta} = await db.providers.findOneAsync<
    IProvider<TESPNPlusTokens, IEspnPlusMeta>
  >({name: 'espnplus'});
  const {
    enabled: espnLinearEnabled,
    linear_channels,
    meta: linearMeta,
  } = await db.providers.findOneAsync<IProvider<TESPNTokens, IEspnMeta>>({name: 'espn'});

  if (which === 'linear') {
    return espnLinearEnabled && _.some(linear_channels, c => c.enabled);
  } else if (which === 'plus') {
    return espnPlusEnabled;
  } else if (which === 'ppv') {
    return (plusMeta?.use_ppv ? true : false) && espnPlusEnabled;
  } else if (which === 'espn3') {
    return (linearMeta?.espn3 ? true : false) && espnLinearEnabled;
  } else if (which === 'espn3isp') {
    return (linearMeta?.espn3isp ? true : false) && espnLinearEnabled;
  } else if (which === 'sec_plus') {
    return (linearMeta?.sec_plus ? true : false) && espnLinearEnabled;
  } else if (which === 'accnx') {
    return (linearMeta?.accnx ? true : false) && espnLinearEnabled;
  }

  return espnPlusEnabled || (espnLinearEnabled && _.some(linear_channels, c => c.enabled));
};

class EspnHandler {
  public tokens?: ITokens;
  public account_token?: IToken;
  public device_token_exchange?: IToken;
  public device_refresh_token?: IToken;
  public device_grant?: IGrant;
  public id_token_grant?: IGrant;
  public device_token_exchange_expires?: number;
  public device_refresh_token_expires?: number;
  public account_token_expires?: number;

  public adobe_device_id?: string;
  public adobe_auth?: IAdobeAuth;

  private appConfig: IAppConfig;
  private graphQlApiKey: string;

  public initialize = async () => {
    const setupPlus = (await db.providers.countAsync({name: 'espnplus'})) > 0 ? true : false;

    if (!setupPlus) {
      const data: TESPNPlusTokens = {};

      if (useEspnPlus) {
        this.loadJSON();

        data.tokens = this.tokens;
        data.device_grant = this.device_grant;
        data.device_token_exchange = this.device_token_exchange;
        data.device_refresh_token = this.device_refresh_token;
        data.id_token_grant = this.id_token_grant;
        data.account_token = this.account_token;
      }

      await db.providers.insertAsync<IProvider<TESPNPlusTokens, IEspnPlusMeta>>({
        enabled: useEspnPlus,
        meta: {
          hide_studio: false,
          in_market_teams: '',
          use_ppv: useEspnPpv,
          zip_code: '',
        },
        name: 'espnplus',
        tokens: data,
      });

      if (fs.existsSync(espnPlusTokens)) {
        fs.rmSync(espnPlusTokens);
      }
    }

    const setupLinear = (await db.providers.countAsync({name: 'espn'})) > 0 ? true : false;

    if (!setupLinear) {
      const data: TESPNTokens = {};

      if (requiresEspnProvider) {
        this.loadJSON();

        data.adobe_device_id = this.adobe_device_id;
        data.adobe_auth = this.adobe_auth;
      }

      await db.providers.insertAsync<IProvider<TESPNTokens, IEspnMeta>>({
        enabled: requiresEspnProvider,
        linear_channels: [
          {
            enabled: useEspn1,
            id: 'espn1',
            name: 'ESPN',
            tmsId: '32645',
          },
          {
            enabled: useEspn2,
            id: 'espn2',
            name: 'ESPN2',
            tmsId: '45507',
          },
          {
            enabled: useEspnU,
            id: 'espnu',
            name: 'ESPNU',
            tmsId: '60696',
          },
          {
            enabled: useSec,
            id: 'sec',
            name: 'SEC Network',
            tmsId: '89714',
          },
          {
            enabled: useAccN,
            id: 'acc',
            name: 'ACC Network',
            tmsId: '111871',
          },
          {
            enabled: useEspnews,
            id: 'espnews',
            name: 'ESPNews',
            tmsId: '59976',
          },
        ],
        meta: {
          accnx: useAccNx,
          espn3: useEspn3,
          espn3isp: false,
          sec_plus: useSecPlus,
        },
        name: 'espn',
        tokens: data,
      });

      if (fs.existsSync(espnLinearTokens)) {
        fs.rmSync(espnLinearTokens);
      }
    }

    if (useEspnPpv) {
      console.log('Using ESPN_PPV variable is no longer needed. Please use the UI going forward');
    }
    if (useEspn1) {
      console.log('Using ESPN variable is no longer needed. Please use the UI going forward');
    }
    if (useEspn2) {
      console.log('Using ESPN2 variable is no longer needed. Please use the UI going forward');
    }
    if (useEspn3) {
      console.log('Using ESPN3 variable is no longer needed. Please use the UI going forward');
    }
    if (useEspnU) {
      console.log('Using ESPNU variable is no longer needed. Please use the UI going forward');
    }
    if (useSec) {
      console.log('Using SEC variable is no longer needed. Please use the UI going forward');
    }
    if (useSecPlus) {
      console.log('Using SECPLUS variable is no longer needed. Please use the UI going forward');
    }
    if (useAccN) {
      console.log('Using ACCN variable is no longer needed. Please use the UI going forward');
    }
    if (useAccNx) {
      console.log('Using ACCNX variable is no longer needed. Please use the UI going forward');
    }
    if (useEspnews) {
      console.log('Using ESPNEWS variable is no longer needed. Please use the UI going forward');
    }

    const enabled = await isEnabled();

    if (!enabled) {
      return;
    }

    const {meta: plusMeta} = await db.providers.findOneAsync<IProvider<TESPNPlusTokens, IEspnPlusMeta>>({
      name: 'espnplus',
    });

    if (!plusMeta?.zip_code || !plusMeta?.in_market_teams) {
      await this.refreshInMarketTeams();
    }

    // Load tokens from local file and make sure they are valid
    await this.load();

    if (!this.appConfig) {
      await this.getAppConfig();
    }
  };

  public refreshTokens = async () => {
    const espnPlusEnabled = await isEnabled('plus');

    if (espnPlusEnabled) {
      await this.updatePlusTokens();
    }

    const espnLinearEnabled = await isEnabled('linear');

    if (espnLinearEnabled && willAdobeTokenExpire(this.adobe_auth)) {
      console.log('Refreshing TV Provider token (ESPN)');
      await this.refreshProviderToken();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const espnPlusEnabled = await isEnabled('plus');
    const espnPpvEnabled = await isEnabled('ppv');
    const espnLinearEnabled = await isEnabled('linear');
    const secPlusEnabled = await isEnabled('sec_plus');
    const espn3Enabled = await isEnabled('espn3');
    const accnxEnabled = await isEnabled('accnx');

    const {linear_channels} = await db.providers.findOneAsync<IProvider>({name: 'espn'});

    const isChannelEnabled = (channelId: string): boolean =>
      espnLinearEnabled && linear_channels.some(c => c.id === channelId && c.enabled);

    let entries = [];

    try {
      if (espnPlusEnabled) {
        console.log('Looking for ESPN+ events...');

        const liveEntries = await this.getLiveEvents();
        entries = [...entries, ...liveEntries];
      }

      if (espnLinearEnabled) {
        console.log('Looking for ESPN events');
      }

      if (isChannelEnabled('espn1')) {
        const liveEntries = await this.getLiveEvents('espn1');
        entries = [...entries, ...liveEntries];
      }
      if (isChannelEnabled('espn2')) {
        const liveEntries = await this.getLiveEvents('espn2');
        entries = [...entries, ...liveEntries];
      }
      if (espn3Enabled) {
        const liveEntries = await this.getLiveEvents('espn3');
        entries = [...entries, ...liveEntries];
      }
      if (isChannelEnabled('espnu')) {
        const liveEntries = await this.getLiveEvents('espnU');
        entries = [...entries, ...liveEntries];
      }
      if (isChannelEnabled('sec')) {
        const liveEntries = await this.getLiveEvents('secn');
        entries = [...entries, ...liveEntries];
      }
      if (secPlusEnabled) {
        const liveEntries = await this.getLiveEvents('secnPlus');
        entries = [...entries, ...liveEntries];
      }
      if (isChannelEnabled('acc')) {
        const liveEntries = await this.getLiveEvents('accn');
        entries = [...entries, ...liveEntries];
      }
      if (accnxEnabled) {
        const liveEntries = await this.getLiveEvents('accnx');
        entries = [...entries, ...liveEntries];
      }
      if (isChannelEnabled('espnews')) {
        const liveEntries = await this.getLiveEvents('espnews');
        entries = [...entries, ...liveEntries];
      }
      if (espnPpvEnabled) {
        const liveEntries = await this.getLiveEvents('espn_ppv');
        entries = [...entries, ...liveEntries];
      }
    } catch (e) {
      console.log('Could not parse ESPN events');
    }

    const today = new Date();

    for (const [i] of [0, 1, 2].entries()) {
      const date = moment(today).add(i, 'days');

      try {
        if (espnPlusEnabled) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'));
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('espn1')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espn1');
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('espn2')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espn2');
          entries = [...entries, ...upcomingEntries];
        }
        if (espn3Enabled) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espn3');
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('espnu')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espnU');
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('sec')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'secn');
          entries = [...entries, ...upcomingEntries];
        }
        if (secPlusEnabled) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'secnPlus');
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('acc')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'accn');
          entries = [...entries, ...upcomingEntries];
        }
        if (accnxEnabled) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'accnx');
          entries = [...entries, ...upcomingEntries];
        }
        if (isChannelEnabled('espnews')) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espnews');
          entries = [...entries, ...upcomingEntries];
        }
        if (espnPpvEnabled) {
          const upcomingEntries = await this.getUpcomingEvents(date.format('YYYY-MM-DD'), 'espn_ppv');
          entries = [...entries, ...upcomingEntries];
        }
      } catch (e) {
        console.log('Could not parse ESPN events');
      }
    }

    try {
      await parseAirings(entries);
    } catch (e) {
      console.log('Could not parse events');
      console.log(e.message);
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    const espnPlusEnabled = await isEnabled('plus');
    espnPlusEnabled && (await this.getBamAccessToken());
    espnPlusEnabled && (await this.getGraphQlApiKey());

    try {
      const {data: scenarios} = await instance.get('https://watch.graph.api.espn.com/api', {
        params: {
          apiKey: this.graphQlApiKey,
          query: `{airing(id:"${eventId}",countryCode:"us",deviceType:SETTOP,tz:"Z") {id name description mrss:adobeRSS authTypes requiresLinearPlayback status:type startDateTime endDateTime duration source(authorization: SHIELD) { url authorizationType hasEspnId3Heartbeats hasNielsenWatermarks hasPassThroughAds commercialReplacement startSessionUrl } network { id type name adobeResource } image { url } sport { name code uid } league { name uid } program { code categoryCode isStudio } seekInSeconds simulcastAiringId airingId tracking { nielsenCrossId1 trackingId } eventId packages { name } language tier feedName brands { id name type }}}`,
        },
      });

      if (!scenarios?.data?.airing?.source?.url.length || scenarios?.data?.airing?.status !== 'LIVE') {
        // console.log('Event status: ', scenarios?.data?.airing?.status);
        throw new Error('No streaming data available');
      }

      const scenarioUrl = scenarios.data.airing.source.url.replace('{scenario}', 'browser~ssai');

      let isEspnPlus = true;
      let headers: IHeaders = {};
      let uri: string;

      if (scenarios?.data?.airing?.source?.authorizationType === 'SHIELD') {
        // console.log('Scenario: ', scenarios?.data?.airing);
        isEspnPlus = false;
      }

      if (isEspnPlus) {
        const {data} = await axios.get(scenarioUrl, {
          headers: {
            Accept: 'application/vnd.media-service+json; version=2',
            Authorization: this.account_token.access_token,
            Origin: 'https://plus.espn.com',
            'User-Agent': userAgent,
          },
        });

        uri = data.stream.slide ? data.stream.slide : data.stream.complete;
        headers = {
          Authorization: this.account_token.access_token,
        };
      } else {
        let tokenType = 'DEVICE';
        let token = this.adobe_device_id;

        let isEspn3isp = false;
        if (scenarios?.data?.airing?.network?.id === 'espn3' && (await isEnabled('espn3isp'))) {
          isEspn3isp = true;
        }

        if (
          !isEspn3isp &&
          _.some(scenarios?.data?.airing?.authTypes, (authType: string) => authType.toLowerCase() === 'mvpd')
        ) {
          // Try to get the media token, but if it fails, let's just try device authentication
          try {
            await this.authorizeEvent(eventId, scenarios?.data?.airing?.mrss);

            const mediaTokenUrl = [
              'https://',
              'api.auth.adobe.com',
              '/api/v1',
              '/mediatoken',
              '?requestor=ESPN',
              `&deviceId=${this.adobe_device_id}`,
              `&resource=${encodeURIComponent(scenarios?.data?.airing?.mrss)}`,
            ].join('');

            const {data} = await axios.get(mediaTokenUrl, {
              headers: {
                Authorization: createAdobeAuthHeader('GET', mediaTokenUrl, ADOBE_KEY, ADOBE_PUBLIC_KEY),
                'User-Agent': userAgent,
              },
            });

            tokenType = 'ADOBEPASS';
            token = data.serializedToken;
          } catch (e) {
            console.error(e);
            console.log('could not get mediatoken');
          }
        }

        // Get stream data
        const authenticatedUrl = [
          `https://broadband.espn.com/espn3/auth/watchespn/startSession?channel=${scenarios?.data?.airing?.network?.id}&simulcastAiringId=${scenarios?.data?.airing?.simulcastAiringId}`,
          '&partner=watchespn',
          '&playbackScenario=HTTP_CLOUD_HIGH',
          '&platform=chromecast_uplynk',
          '&v=2.0.0',
          `&token=${token}`,
          `&tokenType=${tokenType}`,
          `&resource=${Buffer.from(scenarios?.data?.airing?.mrss, 'utf-8').toString('base64')}`,
        ].join('');

        const {data: authedData} = await axios.get(authenticatedUrl, {
          headers: {
            'User-Agent': userAgent,
          },
        });

        uri = authedData?.session?.playbackUrls?.default;
        headers = {
          Connection: 'keep-alive',
          Cookie: `_mediaAuth: ${authedData?.session?.token}`,
          'User-Agent': userAgent,
        };
      }

      return [uri, headers];
    } catch (e) {
      // console.error(e);
      console.log('Could not get stream data. Event might be upcoming, ended, or in blackout...');
    }
  };

  public refreshAuth = async (): Promise<void> => {
    try {
      const {data: refreshTokenData} = await axios.post(urlBuilder(REFRESH_AUTH_URL, ANDROID_ID), {
        refreshToken: this.tokens.refresh_token,
      });

      this.tokens = refreshTokenData.data.token;
      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not get auth refresh token (ESPN+)');
    }
  };

  private updatePlusTokens = _.throttle(
    async () => {
      if (!isTokenValid(this.tokens?.id_token) || willTokenExpire(this.tokens?.id_token)) {
        console.log('Refreshing auth token (ESPN+)');
        await this.refreshAuth();
      }

      if (!this.device_token_exchange || willTimestampExpire(this.device_token_exchange_expires)) {
        console.log('Refreshing device token (ESPN+)');
        await this.getDeviceTokenExchange();
      }

      if (!this.device_refresh_token || willTimestampExpire(this.device_refresh_token_expires)) {
        console.log('Refreshing device refresh token (ESPN+)');
        await this.getDeviceRefreshToken();
      }

      if (!this.account_token || willTimestampExpire(this.account_token_expires)) {
        console.log('Refreshing BAM access token (ESPN+)');
        await this.getBamAccessToken();
      }
    },
    60 * 1000,
    {leading: true, trailing: false},
  );

  private getLiveEvents = async (network?: string) => {
    await this.getGraphQlApiKey();

    const [networks, packages] = getNetworkInfo(network);

    const query =
      'query Airings ( $countryCode: String!, $deviceType: DeviceType!, $tz: String!, $type: AiringType, $categories: [String], $networks: [String], $packages: [String], $eventId: String, $packageId: String, $start: String, $end: String, $day: String, $limit: Int ) { airings( countryCode: $countryCode, deviceType: $deviceType, tz: $tz, type: $type, categories: $categories, networks: $networks, packages: $packages, eventId: $eventId, packageId: $packageId, start: $start, end: $end, day: $day, limit: $limit ) { id airingId simulcastAiringId name type startDateTime shortDate: startDate(style: SHORT) authTypes adobeRSS duration feedName purchaseImage { url } image { url } network { id type abbreviation name shortName adobeResource isIpAuth } source { url authorizationType hasPassThroughAds hasNielsenWatermarks hasEspnId3Heartbeats commercialReplacement } packages { name } category { id name } subcategory { id name } sport { id name abbreviation code } league { id name abbreviation code } franchise { id name } program { id code categoryCode isStudio } tracking { nielsenCrossId1 nielsenCrossId2 comscoreC6 trackingId } } }';
    const variables = `{"deviceType":"DESKTOP","countryCode":"US","tz":"UTC+0000","type":"LIVE","networks":${networks},"packages":${packages},"limit":500}`;

    const {data: entryData} = await instance.get(
      encodeURI(
        `https://watch.graph.api.espn.com/api?apiKey=${this.graphQlApiKey}&query=${query}&variables=${variables}`,
      ),
    );

    debug.saveRequestData(entryData, network || 'espn+', 'live-epg');

    return entryData.data.airings;
  };

  private getUpcomingEvents = async (date: string, network?: string) => {
    await this.getGraphQlApiKey();

    const [networks, packages] = getNetworkInfo(network);

    const query =
      'query Airings ( $countryCode: String!, $deviceType: DeviceType!, $tz: String!, $type: AiringType, $categories: [String], $networks: [String], $packages: [String], $eventId: String, $packageId: String, $start: String, $end: String, $day: String, $limit: Int ) { airings( countryCode: $countryCode, deviceType: $deviceType, tz: $tz, type: $type, categories: $categories, networks: $networks, packages: $packages, eventId: $eventId, packageId: $packageId, start: $start, end: $end, day: $day, limit: $limit ) { id airingId simulcastAiringId name type startDateTime shortDate: startDate(style: SHORT) authTypes adobeRSS duration feedName purchaseImage { url } image { url } network { id type abbreviation name shortName adobeResource isIpAuth } source { url authorizationType hasPassThroughAds hasNielsenWatermarks hasEspnId3Heartbeats commercialReplacement } packages { name } category { id name } subcategory { id name } sport { id name abbreviation code } league { id name abbreviation code } franchise { id name } program { id code categoryCode isStudio } tracking { nielsenCrossId1 nielsenCrossId2 comscoreC6 trackingId } } }';
    const variables = `{"deviceType":"DESKTOP","countryCode":"US","tz":"UTC+0000","type":"UPCOMING","networks":${networks},"packages":${packages},"day":"${date}","limit":500}`;

    const {data: entryData} = await instance.get(
      encodeURI(
        `https://watch.graph.api.espn.com/api?apiKey=${this.graphQlApiKey}&query=${query}&variables=${variables}`,
      ),
    );

    debug.saveRequestData(entryData, network || 'espn+', 'upcoming-epg');

    return entryData.data.airings;
  };

  private authorizeEvent = async (eventId: string, mrss: string): Promise<void> => {
    if (mrss && authorizedResources[eventId]) {
      return;
    }

    const authorizeEventTokenUrl = [
      'https://',
      'api.auth.adobe.com',
      '/api/v1',
      '/authorize',
      '?requestor=ESPN',
      `&deviceId=${this.adobe_device_id}`,
      `&resource=${encodeURIComponent(mrss)}`,
    ].join('');

    try {
      await axios.get(authorizeEventTokenUrl, {
        headers: {
          Authorization: createAdobeAuthHeader('GET', authorizeEventTokenUrl, ADOBE_KEY, ADOBE_PUBLIC_KEY),
          'User-Agent': userAgent,
        },
      });

      authorizedResources[eventId] = true;
    } catch (e) {
      console.error(e);
      console.log('Could not authorize event. Might be blacked out or not available from your TV provider');
    }
  };

  public getLinearAuthCode = async (): Promise<string> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    this.adobe_device_id = getRandomHex();

    const regUrl = ['https://', 'api.auth.adobe.com', '/reggie/', 'v1/', 'ESPN', '/regcode'].join('');

    try {
      const {data} = await axios.post(
        regUrl,
        new url.URLSearchParams({
          deviceId: this.adobe_device_id,
          deviceType: 'android_tv',
          ttl: '1800',
        }).toString(),
        {
          headers: {
            Authorization: createAdobeAuthHeader('POST', regUrl, ADOBE_KEY, ADOBE_PUBLIC_KEY),
            'User-Agent': userAgent,
          },
        },
      );

      return data.code;
    } catch (e) {
      console.error(e);
      console.log('Could not start the authentication process!');
    }
  };

  public authenticateLinearRegCode = async (regcode: string): Promise<boolean> => {
    const regUrl = ['https://', 'api.auth.adobe.com', '/api/v1/', 'authenticate/', regcode, '?requestor=ESPN'].join('');

    try {
      const {data} = await axios.get<IAdobeAuth>(regUrl, {
        headers: {
          Authorization: createAdobeAuthHeader('GET', regUrl, ADOBE_KEY, ADOBE_PUBLIC_KEY),
          'User-Agent': userAgent,
        },
      });

      this.adobe_auth = data;
      await this.save();

      return true;
    } catch (e) {
      if (e.response?.status !== 404) {
        console.error(e);
        console.log('Could not get provider token data!');
      }

      return false;
    }
  };

  private refreshProviderToken = async (): Promise<void> => {
    const renewUrl = [
      'https://',
      'api.auth.adobe.com',
      '/api/v1/',
      'tokens/authn',
      '?requestor=ESPN',
      `&deviceId=${this.adobe_device_id}`,
    ].join('');

    try {
      const {data} = await axios.get<IAdobeAuth>(renewUrl, {
        headers: {
          Authorization: createAdobeAuthHeader('GET', renewUrl, ADOBE_KEY, ADOBE_PUBLIC_KEY),
          'User-Agent': userAgent,
        },
      });

      this.adobe_auth = data;
      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not refresh provider token data!');
    }
  };

  public getPlusAuthCode = async (): Promise<string> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    const apiKey = await getApiKey(ANDROID_ID);

    try {
      const {data: licensePlate} = await axios.post(
        urlBuilder(LICENSE_PLATE_URL, ANDROID_ID),
        {
          adId: getRandomHex(),
          'correlation-id': getRandomHex(),
          deviceId: getRandomHex(),
          deviceType: 'ANDTV',
          entitlementPath: 'login',
          entitlements: [],
        },
        {
          headers: {
            Authorization: `APIKEY ${apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      const {data: wsInfo} = await axios.get(`${licensePlate.data.fastCastHost}/public/websockethost`);

      wsPlus.initializeWebSocket(
        `wss://${wsInfo.ip}:${wsInfo.securePort}/FastcastService/pubsub/profiles/${licensePlate.data.fastCastProfileId}?TrafficManager-Token=${wsInfo.token}`,
        licensePlate,
      );

      setTimeout(() => wsPlus.closeWebSocket(), 5 * 60 * 1000);

      return licensePlate.data.pairingCode;
    } catch (e) {
      console.error(e);
      console.log('Could not start the authentication process!');
    }
  };

  public authenticatePlusRegCode = async (): Promise<boolean> => {
    if (wsPlus.wsToken) {
      this.tokens = wsPlus.wsToken;

      await this.save();

      wsPlus.closeWebSocket();
      return true;
    }

    return false;
  };

  public refreshInMarketTeams = async () => {
    try {
      const deviceUrl = ['https://', 'espn.api.edge.bamgrid.com', '/graph/v1/', 'device/graphql'].join('');

      const {data: deviceData} = await axios.post(
        deviceUrl,
        {
          operationName: 'registerDevice',
          query:
            '\n    mutation registerDevice($input: RegisterDeviceInput!) {\n        registerDevice(registerDevice: $input) {\n            grant {\n                grantType\n                assertion\n            }\n        }\n    }\n',
          variables: {
            input: {
              applicationRuntime: 'chrome',
              attributes: {
                brand: 'web',
                browserName: 'chrome',
                browserVersion: '128.0.0',
                manufacturer: 'apple',
                model: null,
                operatingSystem: 'macintosh',
                operatingSystemVersion: '10.15.7',
                osDeviceIds: [],
              },
              deviceFamily: 'browser',
              deviceLanguage: 'en-US',
              devicePlatformId: 'browser',
              deviceProfile: 'macosx',
            },
          },
        },
        {
          headers: {
            Authorization: BAM_API_KEY,
            'Content-Type': 'application/json',
            'User-Agent': userAgent,
          },
        },
      );

      const zip_code = deviceData.extensions.sdk.session.location.zipCode;

      await db.providers.updateAsync({name: 'espnplus'}, {$set: {'meta.zip_code': zip_code}});

      const lookupUrl = ['https://', 'api-web.nhle.com', '/v1/postal-lookup/', zip_code].join('');

      const {data: lookupData} = await axios.get(lookupUrl, {
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': userAgent,
        },
      });

      const teams = lookupData.map(team => team.teamName.default);
      const in_market_teams = teams.join(',');
      console.log(`Detected in-market teams ${in_market_teams} (${zip_code})`);

      await db.providers.updateAsync({name: 'espnplus'}, {$set: {'meta.in_market_teams': in_market_teams}});

      return {in_market_teams, zip_code};
    } catch (e) {
      console.error(e);
      console.log('Could not refresh in-market teams data!');
    }
  };

  public ispAccess = async (): Promise<boolean> => {
    try {
      await this.getGraphQlApiKey();

      const [networks, packages] = getNetworkInfo('espn3');

      const query =
        'query Airings ( $countryCode: String!, $deviceType: DeviceType!, $tz: String!, $type: AiringType, $categories: [String], $networks: [String], $packages: [String], $eventId: String, $packageId: String, $start: String, $end: String, $day: String, $limit: Int ) { airings( countryCode: $countryCode, deviceType: $deviceType, tz: $tz, type: $type, categories: $categories, networks: $networks, packages: $packages, eventId: $eventId, packageId: $packageId, start: $start, end: $end, day: $day, limit: $limit ) { id airingId simulcastAiringId name type startDateTime shortDate: startDate(style: SHORT) authTypes adobeRSS duration feedName purchaseImage { url } image { url } network { id type abbreviation name shortName adobeResource isIpAuth } source { url authorizationType hasPassThroughAds hasNielsenWatermarks hasEspnId3Heartbeats commercialReplacement } packages { name } category { id name } subcategory { id name } sport { id name abbreviation code } league { id name abbreviation code } franchise { id name } program { id code categoryCode isStudio } tracking { nielsenCrossId1 nielsenCrossId2 comscoreC6 trackingId } } }';
      const variables = `{"deviceType":"DESKTOP","countryCode":"US","tz":"UTC+0000","type":"REPLAY","networks":${networks},"packages":${packages},"limit":10}`;

      const {data: entryData} = await instance.get(
        encodeURI(
          `https://watch.graph.api.espn.com/api?apiKey=${this.graphQlApiKey}&query=${query}&variables=${variables}`,
        ),
      );

      const apiKey = [
        'u',
        'i',
        'q',
        'l',
        'b',
        'g',
        'z',
        'd',
        'w',
        'u',
        'r',
        'u',
        '1',
        '4',
        'v',
        '6',
        '2',
        '7',
        'v',
        'd',
        'u',
        's',
        's',
        'w',
        'b',
      ].join('');
      const randomInt: number = Math.floor(Math.random() * entryData.data.airings.length);
      const eventUrl = [
        'https://',
        'watch.auth.api.espn.com',
        '/video/auth/',
        'media/',
        entryData.data.airings[randomInt].id,
        '/asset',
        '?apikey=',
        apiKey,
      ].join('');

      try {
        const {data} = await axios.post(eventUrl, {
          headers: {
            'User-Agent': userAgent,
          },
        });

        if (data.stream) {
          console.log('Detected ISP access');
          return true;
        }
      } catch (e) {
        console.log('Did not detect ISP access');
      }
    } catch (e) {
      console.log('Could not check ISP access');
    }
    return false;
  };

  private getAppConfig = async () => {
    try {
      const {data} = await axios.get<IAppConfig>(BAM_APP_CONFIG);
      this.appConfig = data;
    } catch (e) {
      console.error(e);
      console.log('Could not load API app config');
    }
  };

  private getGraphQlApiKey = async () => {
    if (!this.graphQlApiKey) {
      try {
        const {data: espnKeys} = await axios.get(
          'https://a.espncdn.com/connected-devices/app-configurations/espn-js-sdk-web-2.0.config.json',
        );
        this.graphQlApiKey = espnKeys.graphqlapi.apiKey;
      } catch (e) {
        console.error(e);
        console.log('Could not get GraphQL API key');
      }
    }
  };

  private createDeviceGrant = async () => {
    if (!this.device_grant || !isTokenValid(this.device_grant.assertion)) {
      try {
        this.device_grant = await makeApiCall(this.appConfig.services.device.client.endpoints.createDeviceGrant, {
          applicationRuntime: 'chrome',
          attributes: {},
          deviceFamily: 'browser',
          deviceProfile: 'linux',
        });

        await this.save();
      } catch (e) {
        console.error(e);
        console.log('Could not get device grant');
      }
    }
  };

  private createAccountGrant = async () => {
    await this.getDeviceRefreshToken();

    if (!this.id_token_grant || !isTokenValid(this.id_token_grant.assertion)) {
      try {
        this.id_token_grant = await makeApiCall(
          this.appConfig.services.account.client.endpoints.createAccountGrant,
          {
            id_token: this.tokens.id_token,
          },
          this.device_refresh_token.access_token,
        );

        await this.save();
      } catch (e) {
        console.error(e);
        console.log('Could not get account grant');
      }
    }
  };

  private getDeviceTokenExchange = async () => {
    await this.createDeviceGrant();

    if (!this.device_token_exchange || willTimestampExpire(this.device_token_exchange_expires)) {
      try {
        this.device_token_exchange = await makeApiCall(this.appConfig.services.token.client.endpoints.exchange, {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          latitude: 0,
          longitude: 0,
          platform: 'browser',
          setCookie: false,
          subject_token: this.device_grant.assertion,
          subject_token_type: 'urn:bamtech:params:oauth:token-type:device',
        });
        this.device_token_exchange_expires = moment().add(this.device_token_exchange.expires_in, 'seconds').valueOf();

        await this.save();
      } catch (e) {
        console.error(e);
        console.log('Could not get device token exchange');
      }
    }
  };

  private getDeviceRefreshToken = async () => {
    await this.getDeviceTokenExchange();

    if (!this.device_refresh_token || willTimestampExpire(this.device_refresh_token_expires)) {
      try {
        this.device_refresh_token = await makeApiCall(this.appConfig.services.token.client.endpoints.exchange, {
          grant_type: 'refresh_token',
          latitude: 0,
          longitude: 0,
          platform: 'browser',
          refresh_token: this.device_token_exchange.refresh_token,
          setCookie: false,
        });
        this.device_refresh_token_expires = moment().add(this.device_refresh_token.expires_in, 'seconds').valueOf();

        await this.save();
      } catch (e) {
        console.error(e);
        console.log('Could not get device token exchange');
      }
    }
  };

  private getBamAccessToken = async () => {
    await this.createAccountGrant();

    if (!this.account_token || willTimestampExpire(this.account_token_expires)) {
      try {
        this.account_token = await makeApiCall(this.appConfig.services.token.client.endpoints.exchange, {
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          latitude: 0,
          longitude: 0,
          platform: 'browser',
          setCookie: false,
          subject_token: this.id_token_grant.assertion,
          subject_token_type: 'urn:bamtech:params:oauth:token-type:account',
        });
        this.account_token_expires = moment().add(this.account_token.expires_in, 'seconds').valueOf();

        await this.save();
      } catch (e) {
        console.error(e);
        console.log('Could not get BAM access token');
      }
    }
  };

  private save = async (): Promise<void> => {
    await db.providers.updateAsync(
      {name: 'espnplus'},
      {$set: {tokens: _.omit(this, 'appConfig', 'graphQlApiKey', 'adobe_auth', 'adobe_device_id')}},
    );

    await db.providers.updateAsync({name: 'espn'}, {$set: {tokens: _.pick(this, 'adobe_auth', 'adobe_device_id')}});
  };

  private load = async (): Promise<void> => {
    const {tokens: plusTokens} = await db.providers.findOneAsync<IProvider<TESPNPlusTokens>>({name: 'espnplus'});
    const {
      tokens,
      device_grant,
      device_token_exchange,
      device_refresh_token,
      id_token_grant,
      account_token,
      device_token_exchange_expires,
      device_refresh_token_expires,
      account_token_expires,
    } = plusTokens;

    this.tokens = tokens;
    this.device_grant = device_grant;
    this.device_token_exchange = device_token_exchange;
    this.device_refresh_token = device_refresh_token;
    this.id_token_grant = id_token_grant;
    this.account_token = account_token;
    this.device_token_exchange_expires = device_token_exchange_expires;
    this.device_refresh_token_expires = device_refresh_token_expires;
    this.account_token_expires = account_token_expires;

    const {tokens: linearTokens} = await db.providers.findOneAsync<IProvider<TESPNTokens>>({name: 'espn'});
    const {adobe_device_id, adobe_auth} = linearTokens;

    this.adobe_device_id = adobe_device_id;
    this.adobe_auth = adobe_auth;
  };

  private loadJSON = () => {
    if (fs.existsSync(espnPlusTokens)) {
      const {tokens, device_grant, device_token_exchange, device_refresh_token, id_token_grant, account_token} =
        fsExtra.readJSONSync(espnPlusTokens);

      this.tokens = tokens;
      this.device_grant = device_grant;
      this.device_token_exchange = device_token_exchange;
      this.device_refresh_token = device_refresh_token;
      this.id_token_grant = id_token_grant;
      this.account_token = account_token;
    }

    if (fs.existsSync(espnLinearTokens)) {
      const {adobe_device_id, adobe_auth} = fsExtra.readJSONSync(espnLinearTokens);

      this.adobe_device_id = adobe_device_id;
      this.adobe_auth = adobe_auth;
    }
  };
}

export type TESPNPlusTokens = Omit<ClassTypeWithoutMethods<EspnHandler>, 'adobe_device_id' | 'adobe_auth'>;
export type TESPNTokens = Pick<ClassTypeWithoutMethods<EspnHandler>, 'adobe_device_id' | 'adobe_auth'>;

export const espnHandler = new EspnHandler();

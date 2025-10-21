import fs from 'fs';
import fsExtra from 'fs-extra';
import path from 'path';
import axios from 'axios';
import _ from 'lodash';
import moment from 'moment';

import {androidFoxOneUserAgent, userAgent} from './user-agent';
import {configPath} from './config';
import {useFoxOneOnly4k, useFoxOne} from './networks';
import {IAdobeAuthFoxOne} from './adobe-helpers';
import {getRandomHex, normalTimeRange} from './shared-helpers';
import {ClassTypeWithoutMethods, IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {usesLinear} from './misc-db-service';

interface IAppConfig {
  network: {
    identity: {
      host: string;
      entitlementsUrl: string;
      regcodeUrl: string;
      checkAdobeUrl: string;
      loginUrl: string;
    };
    auth: {
      loginWebsiteUrl: string;
    };
    apikey: string;
  };
  playback: {
    baseApiUrl: string;
  };
}

interface IAdobePrelimAuthToken {
  accessToken: string;
  tokenExpiration: number;
  viewerId: string;
  deviceId: string;
  profileId: string;
}

interface IFoxOneEvent {
  airing_type: string;
  audio_only: boolean;
  call_sign: string;
  tags: string[];
  entity_id: string;
  genre_metadata: {
    display_name: string;
  };
  title: string;
  description: string;
  sport_uri?: string;
  start_time: string;
  end_time: string;
  network: string;
  content_sku: string;
  stream_types: string[];
  images: {
    logo?: string;
    series_detail?: string;
    series_list?: string;
  };
  gracenote: {
    station_id?: string;
  };
  is_uhd?: boolean;
  is_multiview?: boolean;
}

interface IFoxOneMeta {
  only4k?: boolean;
  uhd?: boolean;
  dtc_events?: boolean;
  local_station_call_signs?: string[] | string;
}

const foxOneConfigPath = path.join(configPath, 'foxone_tokens.json');

const getMaxRes = (res: string) => {
  switch (res) {
    case 'UHD/HDR':
      return 'UHD/HDR';
    default:
      return 'HD';
  }
};

const parseCategories = (event: IFoxOneEvent) => {
  const categories = ['FOX One', 'FOX'];
  for (const classifier of [...(event.tags || []), ...(event.genre_metadata.display_name || [])]) {
    if (classifier !== null) {
      categories.push(classifier);
    }
  }

  if (event.sport_uri) {
    categories.push(event.sport_uri);
  }

  const hasHDRorSDR = event.stream_types?.some(res => res === 'HDR' || res === 'SDR');
  const isUHD = event.is_uhd;

  if (hasHDRorSDR || isUHD) {
    categories.push('4K');
  }
  return [...new Set(categories)];
};

const parseAirings = async (events: IFoxOneEvent[]) => {
  const useLinear = await usesLinear();

  const [now, inTwoDays] = normalTimeRange();

  const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});

  for (const event of events) {
    const entryExists = await db.entries.findOneAsync<IEntry>({id: `${event.entity_id}`});

    if (!entryExists) {
      const start = moment(event.start_time);
      const end = moment(event.end_time);
      const originalEnd = moment(event.end_time);

      const isLinear = useLinear;

      if (end.isBefore(now) || start.isAfter(inTwoDays)) {
        continue;
      }

      const categories = parseCategories(event);

      if (meta.only4k && !_.some(categories, category => category === '4K')) {
        continue;
      }

      const eventName = `${event.sport_uri === 'NFL' ? `${event.sport_uri} - ` : ''}${event.title}`;

      console.log(`Adding event: ${event.call_sign}: ${eventName}`);

      await db.entries.insertAsync<IEntry>({
        categories,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'foxone',
        id: event.entity_id,
        image: event.images.logo || event.images.series_detail || event.images.series_list,
        name: eventName,
        network: event.call_sign,
        originalEnd: originalEnd.valueOf(),
        replay: event.airing_type !== 'live' && event.airing_type !== 'new',
        start: start.valueOf(),
        ...(isLinear && {
          channel: event.network,
          linear: true,
        }),
      });
    }
  }
};

const FOXONE_APP_CONFIG = 'https://config.foxplus.com/androidtv/1.3/config/info.json';
// Will prelim token expire in the next month?
const willPrelimTokenExpire = (token: IAdobePrelimAuthToken): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 * 30 > (token?.tokenExpiration || 0);
// Will auth token expire in the next day?
const willAuthTokenExpire = (token: IAdobeAuthFoxOne): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 > (token?.tokenExpiration || 0);

const checkEventSku = (entitlements, event: IFoxOneEvent): boolean => {
  if (event.content_sku && Array.isArray(entitlements)) {
    return true;
  }
  return false;
};

class FoxOneHandler {
  public adobe_device_id?: string;
  public adobe_prelim_auth_token?: IAdobePrelimAuthToken;
  public adobe_auth?: IAdobeAuthFoxOne;

  private platform_location?: string;
  private platform_zip?: string;
  private contentEntitlement?: string;
  private homeMetroCode?: string;
  private homeZipCode?: string;
  private entitlements: string[] = [];
  private entArray: string[] = [];
  private contentEnt: any;
  private appConfig: IAppConfig;
  private stationMap: { [key: string]: { network: string; stationId: string; callSign: string } } = {}; // Add stationMap as a class property

  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'foxone'})) > 0 ? true : false;

    if (!setup) {
      const data: TFoxOneTokens = {};

      if (useFoxOne) {
        this.loadJSON();

        data.adobe_auth = this.adobe_auth;
        data.adobe_device_id = this.adobe_device_id;
        data.adobe_prelim_auth_token = this.adobe_prelim_auth_token;
      }

      await db.providers.insertAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({
        enabled: useFoxOne,
        linear_channels: [
          {
            enabled: true,
            id: 'FOX',
            name: 'FOX',
            tmsId: '',
            callSign: '',
          },
          {
            enabled: true,
            id: 'MNTV',
            name: 'MyNetwork TV',
            tmsId: '',
            callSign: '',
          },
          {
            enabled: true,
            id: 'FS1',
            name: 'FS1',
            tmsId: '82547',
          },
          {
            enabled: true,
            id: 'FS2',
            name: 'FS2',
            tmsId: '59305',
          },
          {
            enabled: true,
            id: 'Big Ten Network',
            name: 'B1G Network',
            tmsId: '58321',
          },
          {
            enabled: true,
            id: 'FOX Deportes',
            name: 'FOX Deportes',
            tmsId: '72189',
          },
          {
            enabled: true,
            id: 'FOX News',
            name: 'FOX News Channel',
            tmsId: '60179',
          },
          {
            enabled: true,
            id: 'FOX Business',
            name: 'FOX Business Network',
            tmsId: '58718',
          },
          {
            enabled: true,
            id: 'TMZ',
            name: 'TMZ',
            tmsId: '149408',
          },
          {
            enabled: true,
            id: 'FOX Digital',
            name: 'Masked Singer',
            tmsId: '192070',
          },
          {
            enabled: true,
            id: 'FOX Soul',
            name: 'Fox Soul',
            tmsId: '119212',
          },
          {
            enabled: true,
            id: 'FOX Weather',
            name: 'Fox Weather',
            tmsId: '121307',
          },
          {
            enabled: true,
            id: 'FOX LOCAL',
            name: 'Fox Live Now',
            tmsId: '119219',
          },
        ],
        meta: {
          only4k: useFoxOneOnly4k,
          uhd: getMaxRes(process.env.MAX_RESOLUTION) === 'UHD/HDR',
          local_station_call_signs: '',
        },
        name: 'foxone',
        tokens: data,
      });

      if (fs.existsSync(foxOneConfigPath)) {
        fs.rmSync(foxOneConfigPath);
      }
    }

    if (useFoxOne) {
      console.log('Using FOXONE variable is no longer needed. Please use the UI going forward');
    }
    if (useFoxOneOnly4k) {
      console.log('Using FOXONE_ONLY_4K variable is no longer needed. Please use the UI going forward');
    }
    if (process.env.MAX_RESOLUTION) {
      console.log('Using MAX_RESOLUTION variable is no longer needed. Please use the UI going forward');
    }

    const {enabled} = await db.providers.findOneAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({name: 'foxone'});

    if (!enabled) {
      return;
    }

    // Load tokens from local file and make sure they are valid
    await this.load();

    await this.getEntitlements();
    
    // Update linear_channels during initialization
    await this.getEvents();
  };

  public getEvents = async (): Promise<IFoxOneEvent[]> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    const useLinear = await usesLinear();
    const events: IFoxOneEvent[] = [];

    const [now, inTwoDays] = normalTimeRange();

    const startTime = now.unix();
    const endTime = inTwoDays.unix();

    try {
      await this.getLocation();
      await this.getEntitlements();
      await this.getUserEntitlements();

      const { data: initData } = await axios.get<any>(
        'https://api.fox.com/dtc/product/config/v1/init',
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-fox-apikey': this.appConfig.network.apikey,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
            'x-home-zipcode': this.homeZipCode || '',
            'x-fox-home-dma': this.homeMetroCode || '',
            'x-fox-dma': this.homeMetroCode || '',
            'x-fox-content-entitlement': this.contentEntitlement || '',
            'x-fox-userauth': `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
          },
        },
      );

      const navigationUri = initData?.data?.dynamic_uris?.navigation_uri;

      if (!navigationUri) {
        throw new Error('navigation_uri not found in init data');
      }

      const { data: navData } = await axios.get<any>(
        `https://api.fox.com/dtc${navigationUri}?page=1&size=25`,
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-fox-apikey': this.appConfig.network.apikey,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
            'x-home-zipcode': this.homeZipCode || '',
            'x-fox-home-dma': this.homeMetroCode || '',
            'x-fox-dma': this.homeMetroCode || '',
            'x-fox-content-entitlement': this.contentEntitlement || '',
            'x-fox-userauth': `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
          },
        },
      );

      let lSchedUri: string | undefined = undefined;

      if (navData.data?.items) {
        for (const item of navData.data.items) {
          if (item.subitems) {
            for (const subitem of item.subitems) {
              if (subitem.subitems) {
                const foundDeepSubitem = subitem.subitems.find(
                  (deepSub: any) => deepSub.item_key === "guide"
                );

                if (foundDeepSubitem) {
                  lSchedUri = foundDeepSubitem.page_uri;
                  break;
                }
              }
            }
          }
          if (lSchedUri) {
            break;
          }
        }
      }
      const liveScheduleUri = lSchedUri;

      if (!liveScheduleUri) {
        throw new Error('live_schedule_page_uri not found in init data');
      }

      const { data: scheduleData } = await axios.get<any>(
        `https://api.fox.com/dtc${liveScheduleUri}`,
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-fox-apikey': this.appConfig.network.apikey,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
            'x-home-zipcode': this.homeZipCode || '',
            'x-fox-home-dma': this.homeMetroCode || '',
            'x-fox-dma': this.homeMetroCode || '',
            'x-fox-content-entitlement': this.contentEntitlement || '',
            'x-fox-userauth': `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
          },
        },
      );

      const containerUris: string[] =
        scheduleData?.data.containers?.map((c: any) => c.uri) || [];

      const allContainerData: any[] = [];

      for (const uri of containerUris) {
        try {
          const { data } = await axios.get<any>(
            `https://api.fox.com/dtc${uri}`,
            {
              headers: {
                'User-Agent': androidFoxOneUserAgent,
                authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
                'x-fox-apikey': this.appConfig.network.apikey,
                'x-platform-location': this.platform_location,
                'x-fox-zipcode': this.platform_zip,
                'x-home-zipcode': this.homeZipCode || '',
                'x-fox-home-dma': this.homeMetroCode || '',
                'x-fox-dma': this.homeMetroCode || '',
                'x-fox-content-entitlement': this.contentEntitlement || '',
                'x-fox-userauth': `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
              },
            },
          );

          if (data?.data?.items && Array.isArray(data.data.items)) {
            allContainerData.push(...data.data.items);
          } else {
            console.warn(`No items found in container ${uri}`);
          }

        } catch (err) {
          console.warn(`Failed to fetch container ${uri}:`, err);
        }
      }

      const allEntityIds: string[] = allContainerData
        .filter(item => item && typeof item === 'object' && item.entity_id)
        .map(item => item.entity_id);

      const allEvents = allContainerData.map(event => {
        if (!event.genre_metadata) {
          event.genre_metadata = [];
        }
        return event;
      });

      const stationMap = {};
      for (const event of allEvents) {
        const { call_sign, network, gracenote } = event;

        if (call_sign && network && gracenote?.station_id) {
          if (!stationMap[network]) {
            stationMap[network] = {
              network,
              stationId: gracenote.station_id,
              callSign: call_sign,
            };
          }
        }
      }
      this.stationMap = stationMap;
      //console.log('station Mapping:    ', stationMap);

      // Update linear_channels with static tmsId except for FOX and MNTV
      await db.providers.updateAsync<IProvider<TFoxOneTokens, IFoxOneMeta>, any>(
        {name: 'foxone'},
        {
          $set: {
            linear_channels: [
              {
                enabled: true,
                id: 'FOX',
                name: 'FOX',
                tmsId: this.stationMap['FOX']?.stationId,
                callSign: this.stationMap['FOX']?.callSign,
              },
              {
                enabled: true,
                id: 'MNTV',
                name: 'MyNetwork TV',
                tmsId: this.stationMap['MNTV']?.stationId,
                callSign: this.stationMap['MNTV']?.callSign,
              },
              {
                enabled: true,
                id: 'FS1',
                name: 'FS1',
                tmsId: '82547',
              },
              {
                enabled: true,
                id: 'FS2',
                name: 'FS2',
                tmsId: '59305',
              },
              {
                enabled: true,
                id: 'Big Ten Network',
                name: 'B1G Network',
                tmsId: '58321',
              },
              {
                enabled: true,
                id: 'FOX Deportes',
                name: 'FOX Deportes',
                tmsId: '72189',
              },
              {
                enabled: true,
                id: 'FOX News',
                name: 'FOX News Channel',
                tmsId: '60179',
              },
              {
                enabled: true,
                id: 'FOX Business',
                name: 'FOX Business Network',
                tmsId: '58718',
              },
              {
                enabled: true,
                id: 'TMZ',
                name: 'TMZ',
                tmsId: '149408',
              },
              {
                enabled: true,
                id: 'FOX Digital',
                name: 'Masked Singer',
                tmsId: '192070',
              },
              {
                enabled: true,
                id: 'FOX Soul',
                name: 'Fox Soul',
                tmsId: '119212',
              },
              {
                enabled: true,
                id: 'FOX Weather',
                name: 'Fox Weather',
                tmsId: '121307',
              },
              {
                enabled: true,
                id: 'FOX LOCAL',
                name: 'Fox Live Now',
                tmsId: '119219',
              },
            ],
          },
        },
      );
      //console.log('getEvents: Updated linear_channels with stationMap');
      const provider = await db.providers.findOneAsync({name: 'foxone'});
      //console.log('linear_channels:', provider.linear_channels);

      _.forEach(allEvents, m => {
        if (!m.content_sku) {
          return;
        }

        const hasEntitlement = this.entitlements.some(entitlement => {
          return m.content_sku.includes(entitlement) ||
                 entitlement.includes(m.content_sku);
        });

        if (
          m.call_sign &&
          hasEntitlement &&
          m.is_multiview !== true &&
          !m.audio_only &&
          m.start_time &&
          m.end_time &&
          m.entity_id &&
          !m.entity_id.includes("-long-")
        ) {
          events.push(m);
        }
      });

    } catch (e) {
      console.error('Error while loading FoxOne events:', e);
    }
    return events;
  };
  
// Add a getter method that can be awaited
public getStationMap = async (): Promise<typeof this.stationMap> => {
  try {
    await this.getEvents();          // <-- may throw
    console.log('getStationMap call to this.stationMap:', this.stationMap);
    return this.stationMap;
  } catch (e) {
    console.error('getStationMap failed:', e);
    throw e;
  }
};


  public async getLocation(): Promise<void> {
    const { data: locatorData } = await axios.get<any>(
      'https://ent.fox.com/locator/v1/location',
      {
        headers: {
          'User-Agent': androidFoxOneUserAgent,
          'x-api-key': this.appConfig.network.apikey,
        },
      }
    );

    const locationData = locatorData?.data?.metadata;
    const zipCodeData = (locatorData?.data?.results || [])[0];

    this.platform_location = locationData?.['x-platform-location'] || 'Unknown Location';
    this.platform_zip = zipCodeData?.['zip_code'] || '00000';
  }

  public async getUserEntitlements(): Promise<void> {
    try {
      await this.getLocation();

      if (!this.appConfig) {
        await this.getAppConfig();
      }

      try {
        const response = await axios.put(
          'https://ent.fox.com/user-preferences/v1/home-location',
          { home_zip_code: this.platform_zip },
          {
            headers: {
              'user-agent': androidFoxOneUserAgent,
              'authorization': `bearer ${this.adobe_auth.accessToken}`,
              'x-api-key': this.appConfig.network.apikey,
              'content-type': 'application/json'
            }
          }
        );
      } catch (error) {
        console.error('Error updating zip code:', error.response?.data || error.message);
        throw error;
      }
      const { data: userEnt } = await axios.get<any>(
        'https://ent.fox.com/user-preferences/v1/preferences',
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            'x-api-key': this.appConfig.network.apikey || '',
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-platform-location': this.platform_location || '',
          },
        }
      );

      const results = userEnt?.data?.results || [];
      for (const item of results) {
        if (item.key === 'HOME_LOCATION' && item.value) {
          this.homeMetroCode = item.value.home_metro_code || null;
          this.homeZipCode = item.value.home_zip_code || null;
          break;
        }
      }

      const { data: userData } = await axios.post<any>(
        'https://api.fox.com/dtc/product/config/v1/keygen/secondary_info',
        this.contentEnt,
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            'x-fox-apikey': this.appConfig.network.apikey,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-platform-location': this.platform_location || '',
            'x-fox-zipcode': this.platform_zip || '',
            'x-home-zipcode': this.homeZipCode || '',
            'x-fox-home-dma': this.homeMetroCode || '',
            'x-fox-dma': this.homeMetroCode || '',
          },
        }
      );

      const headers = userData?.data?.headers || [];
      const entitlementHeader = headers.find((h: any) => h.key === 'x-fox-content-entitlement');

      if (entitlementHeader && entitlementHeader.value) {
        this.contentEntitlement = entitlementHeader.value;
      } else {
        console.warn('x-fox-content-entitlement not found in response');
      }

    } catch (e) {
      console.error('Error in getUserEntitlements:', e);
    }
  }

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({name: 'foxone'});

    if (!enabled) {
      return;
    }

    if (!this.adobe_prelim_auth_token || willPrelimTokenExpire(this.adobe_prelim_auth_token)) {
      console.log('Updating FOX One prelim token');
      await this.getPrelimToken();
    }

    if (willAuthTokenExpire(this.adobe_auth)) {
      console.log('Refreshing TV Provider token (FOX One)');
      await this.authenticateRegCode();
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled} = await db.providers.findOneAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({name: 'foxone'});

    if (!enabled) {
      return;
    }

    console.log('Looking for FOX One events...');

    try {
      const entries = await this.getEvents();
      await parseAirings(entries);
    } catch (e) {
      console.error(e);
      console.log('Could not parse FOX One events');
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      let cdn = 'cloudfront';
      let data;

      while (cdn === 'akamai' || cdn === 'cloudfront' || cdn === 'fastly') {
        data = await this.getStreamData(eventId);
        cdn = data.stream.CDN;
      }

      if (!data || !data?.stream?.playbackUrl) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      const playURL = data.stream.playbackUrl;

      if (!playURL) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      return [
        playURL,
        {
          'User-Agent': androidFoxOneUserAgent,
        },
      ];
    } catch (e) {
      console.error(e);
      console.log('Could not get stream information!');
    }
  };

  private getStreamData = async (eventId: string): Promise<any> => {
    const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});
    const {uhd} = meta;

    const streamOrder = ['UHD/HDR', 'HD'];

    let resIndex = streamOrder.findIndex(i => i === getMaxRes(uhd ? 'UHD/HDR' : ''));

    if (resIndex < 0) {
      resIndex = 1;
    }

    if (!this.appConfig) {
      await this.getAppConfig();
    }

    let watchData;

    for (let a = resIndex; a < streamOrder.length; a++) {
      let deviceCapabilities: string;
      if (streamOrder[a] === 'UHD/HDR') {
        deviceCapabilities = 'color/HDR,maxRes/UHD';
      } else {
        deviceCapabilities = 'color/SDR,maxRes/HD';
      }

      try {
        const {data} = await axios.post(
          'https://prod.api.digitalvideoplatform.com/foxdtc/v3.0/watchlive',
          {
            asset: {
              id: eventId,
            },
            device: {
              height: 2160,
              model: 'onn. 4K Streaming Box',
              os: 'android',
              osv: '12',
              width: 3840,
            },
            stream: {
              type: 'Live',
            }
          },
          {
            headers: {
              'User-Agent': androidFoxOneUserAgent,
              authorization: this.adobe_auth.accessToken,
              'x-api-key': this.appConfig.network.apikey,
              'x-platform-location': this.platform_location,
              'x-device-capabilities': deviceCapabilities,
            },
          },
        );

        watchData = data;
        break;
      } catch (e) {
        console.log(
          `Could not get stream data for ${streamOrder[a]}. ${
            streamOrder[a + 1] ? `Trying to get ${streamOrder[a + 1]} next...` : ''
          }`,
        );
      }
    }
    return watchData;
  };

  private getAppConfig = async () => {
    try {
      const {data} = await axios.get<IAppConfig>(FOXONE_APP_CONFIG);
      this.appConfig = data;
    } catch (e) {
      console.error(e);
      console.log('Could not load API app config');
    }
  };

  private getEntitlements = async (): Promise<void> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      await this.getLocation();

      const {data} = await axios.get<any>(
        `https://ent.fox.com${this.appConfig.network.identity.entitlementsUrl}?device_type=&device_id=${this.adobe_device_id}&resource=&requestor=`,
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: this.adobe_auth.accessToken,
            'x-api-key': this.appConfig.network.apikey,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
          },
        },
      );

      this.entitlements = [];
      this.entArray = [];
      this.contentEnt = [];

      const results = data?.data?.results;
      if (Array.isArray(results)) {
        this.entArray = results;
        this.entitlements = results
          .map((item: any) => item.contentSku)
          .filter((sku: any) => typeof sku === 'string');
      }

      if (Array.isArray(this.entArray) && this.entArray.length > 0) {
        const transformedEntitlements = this.entArray.map((item: any) => ({
          content_sku: item.contentSku,
          proxied_entitlement: item.proxiedEntitlement,
          entitlement_types: item.entitlementType || []
        }));

        const finalEntitlements = {
          favorites: {
            teams: [],
            series: [],
            leagues: [],
            movies: [],
            specials: [],
          },
          user_entitlement: transformedEntitlements,
          user_onboarding_preferences: []
        };

        this.contentEnt = finalEntitlements;
      }
    } catch (e) {
      console.error(e);
    }
  };

  private getPrelimToken = async (): Promise<void> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.post<IAdobePrelimAuthToken>(
        `https://id.fox.com${this.appConfig.network.identity.loginUrl}`,
        {
          deviceId: this.adobe_device_id,
        },
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            'x-api-key': this.appConfig.network.apikey,
            'x-signature-enabled': true,
          },
        },
      );

      this.adobe_prelim_auth_token = data;
      await this.save();
    } catch (e) {
      console.error(e);
      console.log('Could not get information to start Fox One login flow');
    }
  };

  public getAuthCode = async (): Promise<string> => {
    this.adobe_device_id = _.take(getRandomHex(), 16).join('');
    this.adobe_auth = undefined;

    if (!this.appConfig) {
      await this.getAppConfig();
    }

    await this.getPrelimToken();

    try {
      const {data} = await axios.post(
        `https://id.fox.com${this.appConfig.network.identity.regcodeUrl}`,
        {
          deviceID: this.adobe_device_id,
          isMvpd: true,
          selectedMvpdId: '',
        },
        {
          headers: {
            'User-Agent': androidFoxOneUserAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-api-key': this.appConfig.network.apikey,
          },
        },
      );
      console.log(data.code)

      return data.code;
    } catch (e) {
      console.error(e);
      console.log('Could not start the authentication process for Fox One!');
    }
  };

  public authenticateRegCode = async (showAuthnError = true): Promise<boolean> => {
    try {
      if (!this.appConfig) {
        await this.getAppConfig();
      }

      const {data} = await axios.get(`https://id.fox.com/v2.0/checkadobeauthn/v2/?device_id=${this.adobe_device_id}`, {
        headers: {
          'User-Agent': androidFoxOneUserAgent,
          authorization: !this.adobe_auth?.accessToken
            ? `Bearer ${this.adobe_prelim_auth_token.accessToken}`
            : this.adobe_auth.accessToken,
          'x-api-key': this.appConfig.network.apikey,
          'x-signature-enabled': true,
        },
      });

      this.adobe_auth = data;
      await this.save();

      await this.getEntitlements();

      return true;
    } catch (e) {
      if (e.response?.status !== 404) {
        if (showAuthnError) {
          if (e.response?.status === 410) {
            console.error(e);
            console.log('Adobe AuthN token has expired for FOX One');
          }
        } else if (e.response?.status !== 410) {
          console.error(e);
          console.log('Could not get provider token data for Fox One!');
        }
      }

      return false;
    }
  };

  private save = async () => {
    await db.providers.updateAsync({name: 'foxone'}, {$set: {tokens: _.omit(this, 'appConfig', 'entitlements', 'entArray', 'foxStationId', 'mnStationId', 'platform_location', 'platform_zip', 'contentEnt', 'homeMetroCode', 'homeZipCode','contentEntitlement', 'stationMap')}});
  };

  private load = async (): Promise<void> => {
    const {tokens} = await db.providers.findOneAsync<IProvider<TFoxOneTokens>>({name: 'foxone'});
    const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = tokens;

    this.adobe_device_id = adobe_device_id;
    this.adobe_auth = adobe_auth;
    this.adobe_prelim_auth_token = adobe_prelim_auth_token;
  };

  private loadJSON = () => {
    if (fs.existsSync(foxOneConfigPath)) {
      const {adobe_device_id, adobe_auth, adobe_prelim_auth_token} = fsExtra.readJSONSync(foxOneConfigPath);

      this.adobe_device_id = adobe_device_id;
      this.adobe_auth = adobe_auth;
      this.adobe_prelim_auth_token = adobe_prelim_auth_token;
    }
  };
}

export type TFoxOneTokens = ClassTypeWithoutMethods<FoxOneHandler>;
export const foxOneHandler = new FoxOneHandler();
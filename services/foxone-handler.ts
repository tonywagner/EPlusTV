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
      host: string; // this is the base url -- need to slice the trailing '/' off
      entitlementsUrl: string; 
      regcodeUrl: string; 
      checkAdobeUrl: string;
      loginUrl: string;
    };
    auth: {
      loginWebsiteUrl: string; // returns go.foxone.com -- DO NOT USE - should be go.fox.com
    };
    apikey: string; // was key
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
  isUHD?: boolean;
  is_multiview?: boolean;
}

interface IFoxOneEventsData {
  data: {
      items: IFoxOneEvent[];
  };
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
      return 'HD'; // was 720p before
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

  if (event.stream_types?.find(resolution => resolution === 'HDR' || resolution === 'SDR') || event.isUHD) {
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

const FOXONE_APP_CONFIG = 'https://config.foxplus.com/androidtv/1.2/config/info.json';

// Will prelim token expire in the next month?
const willPrelimTokenExpire = (token: IAdobePrelimAuthToken): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 * 30 > (token?.tokenExpiration || 0);
// Will auth token expire in the next day?
const willAuthTokenExpire = (token: IAdobeAuthFoxOne): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 > (token?.tokenExpiration || 0);

const checkEventSku = (entitlements, event: IFoxOneEvent): boolean => {
  if ( event.content_sku && Array.isArray(entitlements) ) {
    return true;
    };

  return false;
};

class FoxOneHandler {
  public adobe_device_id?: string;
  public adobe_prelim_auth_token?: IAdobePrelimAuthToken;
  public adobe_auth?: IAdobeAuthFoxOne;
  public platform_location?: string;
  public platform_zip?: string;

  private contentEntitlement?: string;
  private homeMetroCode?: string;
  private homeZipCode?: string;
  private entitlements: string[] = [];
  private appConfig: IAppConfig;
  private foxStationId = process.env.FOX_STATION_ID || '20360';
  private mnStationId = process.env.MN_STATION_ID || '26566';

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
          tmsId: this.foxStationId, 
        },
        // Cannot find guide data for MyNetwork TV. This should be looked into again in the future
        // {
        //   enabled: false,
        //   id: 'MNTV', 
        //   name: 'MyNetwork TV',
        //   tmsId: this.mnStationId, 
        // },
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
          tmsId: '58649',
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

    const {enabled, meta, linear_channels} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});
	                 
      await db.providers.updateAsync<IProvider<TFoxOneTokens>, any>(
        {name: 'foxone'},
        {
          $set: {
            linear_channels: linear_channels,
          },
        },
      );
    

    if (!enabled) {
      return;
};
// Load tokens from local file and make sure they are valid
    await this.load();

    await this.getEntitlements();
  };

  public async getLocation(): Promise<void> {
  // Get platform location and zip code from FOX locator API
  const { data: locatorData } = await axios.get<any>(
    'https://ent.fox.com/locator/v1/location',
    {
      headers: {
        'User-Agent': userAgent,
        'x-api-key': this.appConfig.network.apikey,
      },
    }
  );

  // Extract the actual location data from the metadata
    const locationData = locatorData?.data?.metadata;
    const zipCodeData = (locatorData?.data?.results || []) [0];
    
  // Also set the original properties for backward compatibility
    this.platform_location = locationData?.['x-platform-location'] || 'Unknown Location';
    this.platform_zip = zipCodeData?.['zip_code'] || '00000';

  }

public async getUserEntitlements(): Promise<void> {
  try {

    // Ensure necessary configurations are loaded
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

    // Extract home_metro_code and home_zip_code
    const results = userEnt?.data?.results || [];
    for (const item of results) {
      if (item.key === 'HOME_LOCATION' && item.value) {
        this.homeMetroCode = item.value.home_metro_code || null;
        this.homeZipCode = item.value.home_zip_code || null;
        break; 
      }
    }

// Hardcoded x-fox-content-entitlement for now which when decoded returns "This is a test string for decoding purposes.".  Needed for getting local fox event information.
this.contentEntitlement = 'H4sIAAAAAAAA/1TOwQoCMQwE0B9yBffo0YNH/8F202VhNwlNWvv5goIZb/NmSkmz813GrdnGZHY9ui6nb/egVzg5T8l5XgWrXy4pT0UGGDbOkfGNjIX0j9uKJHbkLvm5YyFMSFOpHheXSjDbBfIMWePLg71/8A4AAP///Dq0cBQBAAA=';

//This block is used to get x-fox-content-entitlement and store it in this.contentEntitlement -- Not working as intended, so hardcoded the entitlement for now but kept for future testing
    // const { data: userData } = await axios.post<any>(
    //   'https://api.fox.com/dtc/product/config/v1/keygen/secondary_info',
    //   {},
    //   {
    //     headers: {
    //       'User-Agent': androidFoxOneUserAgent,
    //       'x-fox-apikey': this.appConfig.network.apikey,
    //       authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
    //       'x-platform-location': this.platform_location || '', 
    //       'x-fox-zipcode': this.platform_zip || '',
    //       'x-home-zipcode': this.homeZipCode || '',
    //       'x-fox-home-dma': this.homeMetroCode || '',
    //       'x-fox-dma': this.homeMetroCode || '',
    //     },
    //   }
    // );

    //  // Extract and store x-fox-content-entitlement
    // const headers = userData?.data?.headers || [];
    // const entitlementHeader = headers.find((h: any) => h.key === 'x-fox-content-entitlement');
    // if (entitlementHeader && entitlementHeader.value) {
    //   this.contentEntitlement = entitlementHeader.value;
    //   console.log('Stored x-fox-content-entitlement:', this.contentEntitlement);
    // } else {
    //   console.warn('x-fox-content-entitlement not found in response');
    // }

    //console.log('User Data Call response received.');
    //console.log('User Data:', JSON.stringify(userData, null, 2)); // Should display the response data or empty object if no data

  } catch (e) {
    console.error('Error in getUserEntitlements:', e); // Log error for debugging
  }
}

  public refreshTokens = async () => {
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

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
    const {enabled} = await db.providers.findOneAsync<IProvider>({name: 'foxone'});

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

//   current CDNs for FOX One: akamai, cloudfront(digitalvideoplatform.com), and maybe fastly
      let cdn = 'akamai';
      let data;

      if (cdn === 'akamai' || cdn === 'cloudfront' || cdn === 'fastly') {
        data = await this.getStreamData(eventId);
        cdn = data.stream.CDN;
      }

      if (!data || !data?.stream?.playbackUrl) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      const playURL = data.stream.playbackUrl;

//     console.log('Stream Data Url:', playURL)

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
      try {
        const {data} = await axios.post(
          'https://prod.api.digitalvideoplatform.com/foxdtc/v3.0/watchlive',
{
            asset: {
              id: eventId,
            },
            device:{
              height: 2160,
              width: 3840,
              maxRes: streamOrder[a],
              os: 'android',
              osv: '12',
            },
            stream:{
              type: 'Live',
            }
          },
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
  //  console.log('FOX One selected stream data:', watchData);

    return watchData;
  };

  private getEvents = async (): Promise<IFoxOneEvent[]> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    const useLinear = await usesLinear();
    const events: IFoxOneEvent[] = [];

    const [now, inTwoDays] = normalTimeRange();

    const startTime = now.unix();
    const endTime = inTwoDays.unix();

try {
  // const events: IFoxOneEvent[] = []; removed because it is causing issues getting events

  await this.getLocation();  
  await this.getUserEntitlements();

  // 1. Init request
  const { data: initData } = await axios.get<any>(
    'https://api.fox.com/dtc/product/config/v1/init',
    {
      headers: {
        'User-Agent': userAgent,
        authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
        'x-fox-apikey': this.appConfig.network.apikey,
        'x-platform-location': this.platform_location,
        'x-fox-zipcode': this.platform_zip,
      },
    },
  );

  // 2. Live schedule page URI
  const liveScheduleUri = initData?.data?.dynamic_uris?.live_schedule_page_uri;
  if (!liveScheduleUri) {
    throw new Error('live_schedule_page_uri not found in init data');
  }

  // 3. Fetch live schedule page (prepend base)
  const { data: scheduleData } = await axios.get<any>(
    `https://api.fox.com/dtc${liveScheduleUri}`,
    {
      headers: {
        'User-Agent': userAgent,
        authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
        'x-fox-apikey': this.appConfig.network.apikey,
        'x-platform-location': this.platform_location,
        'x-fox-zipcode': this.platform_zip,
        'x-home-zipcode': this.homeZipCode || '',
        'x-fox-home-dma': this.homeMetroCode || '',
        'x-fox-dma': this.homeMetroCode || '',
        'x-fox-content-entitlement': this.contentEntitlement || '',
      },
    },
  );

  // 4. Extract all container URIs
  const containerUris: string[] =
    scheduleData?.data.containers?.map((c: any) => c.uri) || [];

  // 5. Fetch each container and combine into one list
  const allContainerData: any[] = [];
  for (const uri of containerUris) {
    try {
      const { data } = await axios.get<any>(
        `https://api.fox.com/dtc${uri}`,
        {
          headers: {
            'User-Agent': userAgent,
            authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
            'x-fox-apikey': this.appConfig.network.apikey,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
            'x-home-zipcode': this.homeZipCode || '',
            'x-fox-home-dma': this.homeMetroCode || '',
            'x-fox-dma': this.homeMetroCode || '',
            'x-fox-content-entitlement': this.contentEntitlement || '',
          },
        },
      );
      allContainerData.push(data.data);

      } catch (err) {
      console.warn(`Failed to fetch container ${uri}:`, err);
    }
  }

   // Create a flattened list of all events from the nested `items` array
  const allEvents = allContainerData
  .flatMap(container => container.items ?? [])
  .map(event => {
    if (!event.genre_metadata) {
      // fill with an empty array as default
      event.genre_metadata = { display_name: [] };
    }
    return event;
  });
  // 6. Use the flattened list for the filtering logic

    const uniqueChannels = new Set<string>();
    const channelInfo: any[] = [];

  _.forEach(allEvents, m => {
  // If content_sku is missing, skip this event
  if (!m.content_sku) {
    console.log(`Skipping event - no content_sku: ${m.call_sign}: ${m.description}`);
    return;
  }

  // Check if this event's content_sku matches any of our entitlements
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

      await this.getLocation();  // Ensure location and zip code are set

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
      // The entitlements are in data.data.results, which is an array of objects with contentSku
      const results = data?.data?.results;
      if (Array.isArray(results)) {
        this.entitlements = results
          .map((item: any) => item.contentSku)
          .filter((sku: any) => typeof sku === 'string');
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
    await db.providers.updateAsync({name: 'foxone'}, {$set: {tokens: _.omit(this, 'appConfig', 'entitlements')}});
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
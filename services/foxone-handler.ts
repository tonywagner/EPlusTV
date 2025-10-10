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
      entitlementsUrl: string; // was getentitlements -- may need to change
      regcodeUrl: string; // was accountRegCode
      registerUrl: string; // not sure if necessary yet
      checkAdobeUrl: string; //was checkadobeauthn
      refreshTokenUrl: string; // not sure if necessary yet
      loginUrl: string;
    };
    auth: {
      loginWebsiteUrl: string; // returns go.foxone.com -- DO NOT USE - should be go.fox.com
    };
    apikey: string; // was key
  };
  playback: {
    baseApiUrl: string; // was content.watch
    liveAssetInfoUrl: string; // not sure if necessary yet -- adds v3.0/assetinfo/ to baseApiUrl
  };
  // old API structure below -- comments above shoud be key to most
  // api: {
  //   content: {
  //     watch: string;
  //   };
  //   key: string;
  //   auth: {
  //     accountRegCode: string;
  //     checkadobeauthn: string;
  //     getentitlements: string;
  //   };
  //   profile: {
  //     login: string;
  //   };
  // };
  // auth: {
  //   displayActivationUrl: string;
  // };
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
  genres: string[];
  title: string;
  description: string;
  sport_uri?: string;
  start_time: string;
  end_time: string;
  network: string;
  stream_types: string[];
  images: {
    logo?: string;
    series_detail?: string;
    series_list?: string;
  };
  isUHD?: boolean;
  is_multiview?: boolean;
  content_sku?: string[];
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

const EPG_API_KEY = [
  'Y',
  '5',
  's',
  't',
  '1',
  'H',
  'o',
  'L',
  'L',
  'O',
  'J',
  'F',
  'l',
  'H',
  'S',
  't',
  'A',
  '3',
  'a',
  'l',
  'O',
  'L',
  't',
  'G',
  'J',
  'P',
  'S',
  '7',
  'D',
  'U',
  'x',
  'n',
].join('');

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
  for (const classifier of [...(event.tags || []), ...(event.genres || [])]) {
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
//    const entryExists = await db.entries.findOneAsync<IEntry>({id: `${event.entity_id.replace('_dtc', '')}`});
    const entryExists = await db.entries.findOneAsync<IEntry>({id: `${event.entity_id}`});

    if (!entryExists) {
      const start = moment(event.start_time);
      const end = moment(event.end_time);
      const originalEnd = moment(event.end_time);

      const isLinear = useLinear; 
      // const isLinear = event.network !== 'fox' && useLinear;

      if (!isLinear) {
        end.add(1, 'hour');
      }

      if (end.isBefore(now) || start.isAfter(inTwoDays)) {
        continue;
      }

      const categories = parseCategories(event);

      if (meta.only4k && !_.some(categories, category => category === '4K')) {
        continue;
      }
      
      const eventName = `${event.sport_uri === 'NFL' ? `${event.sport_uri} - ` : ''}${event.title}`;

      console.log('Adding event: ', eventName);

      await db.entries.insertAsync<IEntry>({
        categories,
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'foxone',
//        id: event.entity_id.replace('_dtc', ''),
        id: event.entity_id,
        image: event.images.logo || event.images.series_detail || event.images.series_list,
        name: eventName,
        network: event.call_sign,
        originalEnd: originalEnd.valueOf(),
        replay: event.airing_type !== 'live',
        start: start.valueOf(),
        ...(isLinear && {
          channel: event.network,
          linear: true,
        }),
      });
    }
  }
};

const FOXONE_APP_CONFIG = 'https://config.foxplus.com/androidtv/1.1/config/info.json';

// Will prelim token expire in the next month?
const willPrelimTokenExpire = (token: IAdobePrelimAuthToken): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 * 30 > (token?.tokenExpiration || 0);
// Will auth token expire in the next day?
const willAuthTokenExpire = (token: IAdobeAuthFoxOne): boolean =>
  new Date().valueOf() + 3600 * 1000 * 24 > (token?.tokenExpiration || 0);

const checkEventNetwork = (entitlements, event: IFoxOneEvent): boolean => {
  if ( event.content_sku && (entitlements) ) {
    return true;
  }

  return false;
};

class FoxOneHandler {
  public adobe_device_id?: string;
  public adobe_prelim_auth_token?: IAdobePrelimAuthToken;
  public adobe_auth?: IAdobeAuthFoxOne;
  public platform_location?: string;   //  added to store platform location from locator API
  public platform_zip?: string;

  private entitlements: string[] = [];
  private appConfig: IAppConfig;

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

      // see below for update/addition of Soccer Plus and Deportes linear channels
      await db.providers.insertAsync<IProvider<TFoxOneTokens, IFoxOneMeta>>({
        enabled: useFoxOne,
        linear_channels: [
          {
            enabled: true,
            id: 'fs1',
            name: 'FS1',
            tmsId: '82547',
          },
          {
            enabled: true,
            id: 'fs2',
            name: 'FS2',
            tmsId: '59305',
          },
          {
            enabled: true,
            id: 'btn',
            name: 'B1G Network',
            tmsId: '58321',
          },
          {
            enabled: true,
            id: 'foxdep',
            name: 'FOX Deportes',
            tmsId: '72189',
          },
          {
            enabled: true,
            id: 'WNYW', // need to find out how to get local FOX call sign dynamically
            name: 'FOX',
            tmsId: '20360', // need to find out how to get local FOX tmsId dynamically
          },
          { 
            enabled: true,
            id: 'WWOR', // id: meta.local_station_call_signs[1], need to find out how to get dynamically
            name: 'MyNetwork TV',
            tmsId: '26566', // need to find out how to get local MyNetwork tmsId dynamically
          },
          {
            enabled: true,
            id: 'fnc',
            name: 'FOX News Channel',
            tmsId: '60179',
          },
          {
            enabled: true,
            id: 'fbn',
            name: 'FOX Business Network',
            tmsId: '58649',
          },
          {
            enabled: true,
            id: 'tmz',
            name: 'TMZ',
            tmsId: '149408',
          },
          {
            enabled: true,
            id: 'fmsc',
            name: 'Masked Singer',
            tmsId: '192070',
          },
          {
            enabled: true,
            id: 'soul',
            name: 'Fox Soul',
            tmsId: '149408',
          },
          {
            enabled: true,
            id: 'fwx',
            name: 'Fox Weather',
            tmsId: '121307',
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
	
    // update/add Soccer Plus and Deportes, if necessary
//    if ( linear_channels.length <= 4 ) {
//      linear_channels[3] = {
      //   enabled: true,
      //   id: 'foxdep',
      //   name: 'FOX Deportes',
      //   tmsId: '72189',
      // };
      // linear_channels.push({
      //   enabled: true,
      //   id: 'WNYW', // need to find out how to get local FOX call sign dynamically
      //   name: 'FOX',
      //   tmsId: '20360', // need to find out how to get local FOX tmsId dynamically
      // });
      // linear_channels.push({
      //   enabled: true,
      //   id: 'WWOR', // id: meta.local_station_call_signs[1], need to find out how to get dynamically
      //   name: 'MyNetwork TV',
      //   tmsId: '26566', // need to find out how to get local MyNetwork tmsId dynamically
      // });
      //  linear_channels.push({
      //   enabled: true,
      //   id: 'fnc',
      //   name: 'FOX News Channel',
      //   tmsId: '60179',
      // });
      //  linear_channels.push({
      //   enabled: true,
      //   id: 'fbn',
      //   name: 'FOX Business Network',
      //   tmsId: '58649',
      // });
      // linear_channels.push({
      //   enabled: true,
      //   id: 'tmz',
      //   name: 'TMZ',
      //   tmsId: '149408',
      // });
      // linear_channels.push({
      //   enabled: true,
      //   id: 'fmsc',
      //   name: 'Masked Singer',
      //   tmsId: '192070',
      // });
      // linear_channels.push({
      //   enabled: true,
      //   id: 'soul',
      //   name: 'Fox Soul',
      //   tmsId: '149408',
      // });
      // linear_channels.push({
      //   enabled: true,
      //   id: 'fwx',
      //   name: 'Fox Weather',
      //   tmsId: '121307',
      // });                  
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

// // 1️⃣ Get platform location and zip code from FOX locator API
// const { data: locatorData } = await axios.get(
//   'https://ent.fox.com/locator/v1/location',
//   {
//     headers: {
//       'User-Agent': userAgent,
//       'x-api-key': EPG_API_KEY,
//     },
//   }
// );

// // The platform location is exposed in the response metadata
// const platformLocation = locatorData?.metadata?.x_platform_location;   // [1]
// const platformZip = locatorData?.data?.results?.zip_code; // [2]

// // 2️⃣ Store it for later use (e.g., as a property on the handler)
// this.platform_location = platformLocation;
// this.platform_zip = platformZip;

//    if (!meta.dtc_events) {
//      const events = await db.entries.findAsync({from: 'foxone', id: {$regex: /_dtc/}});
//
//     for (const event of events) {
//        await db.entries.updateAsync({from: 'foxone', id: event.id}, {$set: {id: event.id.replace('_dtc', '')}});
//      }
//
//     await db.providers.updateAsync({name: 'foxone'}, {$set: {meta: {...meta, dtc_events: true}}});
//    }

    // Load tokens from local file and make sure they are valid
    await this.load();

    await this.getEntitlements();
  };

  public async getLocation(): Promise<void> {
  // 1. Get platform location and zip code from FOX locator API
  const { data: locatorData } = await axios.get<any>(
    'https://ent.fox.com/locator/v1/location',
    {
      headers: {
        'User-Agent': userAgent,
        'x-api-key': EPG_API_KEY,
      },
    }
  );

  // The platform location is exposed in the response metadata
  const platformLocation = locatorData?.metadata?.x_platform_location;
  const platformZip = locatorData?.data?.results?.zip_code;

  // Store it for later use
  this.platform_location = platformLocation;
  this.platform_zip = platformZip;

  console.log('Locator Data:', locatorData);
  console.log('Zip Code:', this.platform_zip);
  console.log('Location:', this.platform_location);
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

//   current CDNs for FOX One: akamai, cloudfront(digitalvideoplatform.com)

      // let cdn = 'fastly';
      let cdn = 'akamai';
      let data;

      // while (cdn !== 'akamai|limelight|fastly') {
//      while (cdn === 'fastly') {
      if (cdn === 'akamai' || cdn === 'cloudfront') {
        data = await this.getStreamData(eventId);
        cdn = data.trackingData.properties.CDN;
      }

      if (!data || !data?.url) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      const {data: streamData} = await axios.get(data.url, {
        headers: {
          'User-Agent': androidFoxOneUserAgent,
          'x-api-key': this.appConfig.network.apikey,
          'x-platform-location': this.platform_location,
          'x-fox-zipcode': this.platform_zip,
        },
      });

      if (!streamData.playURL) {
        throw new Error('Could not get stream data. Event might be upcoming, ended, or in blackout...');
      }

      return [
        streamData.playURL,
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
//          'https://prod.api.video.fox/v2.0/watch',
//          this.appConfig.playback.baseApiUrl, // currently is https://prod.api.digitalvideoplatform.com/foxdtc
          'https://prod.api.digitalvideoplatform.com/foxdtc/v3.0/watchlive',
{
//            capabilities: ['fsdk/yo/v3'],
            asset: {
              id: eventId, // was streamId for Fox Sports
            },
            device:{
              height: 2160,
              width: 3840,
              maxRes: streamOrder[a],
              os: 'android',
              osv: '12',
            },
            //            streamId: eventId.replace('_dtc', ''),
            stream:{
              type: 'Live', // was streamId for Fox Sports
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
    console.log('FOX One selected stream data:', watchData);

    return watchData;
  };

  private getEvents = async (): Promise<IFoxOneEvent[]> => {
    if (!this.appConfig) {
      await this.getAppConfig();
    }

    // get local station call sign
    let local_station_call_signs_parameter = '';
    let callsign1 = '';
    let callsign2 = '';

    try {
      const {meta} = await db.providers.findOneAsync<IProvider<any, IFoxOneMeta>>({name: 'foxone'});
      if (!meta.local_station_call_signs || (Array.isArray(meta.local_station_call_signs) && meta.local_station_call_signs.length === 0) || meta.local_station_call_signs === '') {
        console.log('FOX One detecting local FOX and MyNetwork call signs');
        let local_station_call_signs: string[] = [];
        try {
          const {data} = await axios.get(
            'https://ent.fox.com/locator/v1/location',
            {
              headers: {
                'User-Agent': userAgent,
                'x-api-key': EPG_API_KEY,
              },
            },
          );
          const callSignsArr = data?.data?.results?.[0]?.local_station_call_signs;
          if (Array.isArray(callSignsArr) && callSignsArr.length > 0) {
            [callsign1, callsign2] = [
              callSignsArr[0] || '',
              callSignsArr[1] || '',
            ];
            local_station_call_signs = callSignsArr;
            local_station_call_signs_parameter = '%2C' + callSignsArr.join(',');
          } else {
            console.log('FOX One could not find a local FOX call sign');
          }
        } catch (err) {
          console.log('Error fetching local FOX call signs:', err);
        }
        await db.providers.updateAsync({name: 'foxone'}, {$set: {'meta.local_station_call_signs': local_station_call_signs}});
      } else if (meta.local_station_call_signs !== 'none') {
        let callSignsArr: string[] = [];
        if (Array.isArray(meta.local_station_call_signs)) {
          callSignsArr = meta.local_station_call_signs;
        } else if (typeof meta.local_station_call_signs === 'string') {
          callSignsArr = meta.local_station_call_signs.split(',').map(s => s.trim());
        }
        local_station_call_signs_parameter = callSignsArr.length > 0 ? '%2C' + callSignsArr.join(',') : '';
        [callsign1, callsign2] = [
          callSignsArr[0] || '',
          callSignsArr[1] || '',
        ];
      }
    } catch (e) {
      console.log(e);
    }

    const useLinear = await usesLinear();
    const events: IFoxOneEvent[] = [];

    const [now, inTwoDays] = normalTimeRange();

    const startTime = now.unix();
    const endTime = inTwoDays.unix();

//     try {
//       let max_items_per_page = 50;
//       let pages = 1;

//       for (let page = 1; page <= pages; page++) {
//         const {data} = await axios.get<IFoxOneEventsData>(
//       `https://api.fox.com/dtc/product/curated/epg/v1/live-geo/filter?call_sign=&video_type=listing`,
//       {
//         headers: {
//           'User-Agent': userAgent,
//           authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
//           'x-fox-apikey': EPG_API_KEY,
//         },
//       },
//         );

//         debug.saveRequestData(data, 'foxone', 'epg');

//         // Debug: log all items before filtering
//  //       console.log('FOX One raw events:', JSON.stringify(data.data.items, null, 2));

//         _.forEach(data.data.items, m => {
//       // Filter out multiview events and only add if content_sku is in entitlements
//       if (
//         m.call_sign &&
//         checkEventNetwork(this.entitlements, m) &&
//         m.is_multiview !== true &&
//         !m.audio_only &&
//         m.start_time &&
//         m.end_time &&
//         m.entity_id
//       ) {
//         events.push(m);
//         // Print event info to log
//         console.log(
// //          `[FOX One Event]: ${events}`
//         );
//       }
//         });
//       }
//     } catch (e) {
//       console.log(e);
//     }
//     console.log('[FOX One Events]: All filtered events', events);
//     return events;
//   };

////  Replacement FOX One events API call to traverse api and get from containers ////
// <--- Replace the entire try–catch block below ---->
try {
  const events: IFoxOneEvent[] = [];

  await this.getLocation();  // Ensure location and zip code are set

  // 1. Init request
  const { data: initData } = await axios.get<any>(
    'https://api.fox.com/dtc/product/config/v1/init',
    {
      headers: {
        'User-Agent': userAgent,
        authorization: `Bearer ${this.adobe_prelim_auth_token.accessToken}`,
        'x-fox-apikey': EPG_API_KEY,
        'x-platform-location': this.platform_location,
        'x-fox-zipcode': this.platform_zip,
      },
    },
  );
console.log('Zip Code:', this.platform_zip);
console.log('Location:', this.platform_location);
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
        'x-fox-apikey': EPG_API_KEY,
        'x-platform-location': this.platform_location,
        'x-fox-zipcode': this.platform_zip,
      },
    },
  );
//    console.log(`Schedule Data:`, scheduleData.data.containers);


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
            'x-fox-apikey': EPG_API_KEY,
            'x-platform-location': this.platform_location,
            'x-fox-zipcode': this.platform_zip,
          },
        },
      );
//      console.log(JSON.stringify(data, null, 2));
      allContainerData.push(data.data);      // <-- pushes the single object

      } catch (err) {
      console.warn(`Failed to fetch container ${uri}:`, err);
    }
  }
  

  // 6. Use the combined list as the “events” you previously fetched.
  //    You can now run the same filtering logic that follows in the
  //    original code block.
   // Create a flattened list of all events from the nested `items` array
  const allEvents = allContainerData.flatMap(container => container.items || []);

  //console.log(`All Events Data (first 5):`, JSON.stringify(allEvents.slice(0, 5), null, 2));
  // --- End of the fix ---

  // 6. Use the flattened list for your filtering logic
  _.forEach(allEvents, m => {
    if (
      m.call_sign &&
      checkEventNetwork(this.entitlements, m) &&
      m.is_multiview !== true &&
      !m.audio_only &&
      m.start_time &&
      m.end_time &&
      m.entity_id && !m.entity_id.includes("-long-")
    ) {
      events.push(m);
      console.log(`FOX One Event added: ${m.call_sign}: ${m.title} ${m.content_sku}`);
    }
  });
} catch (e) {
  console.error('Error while loading FoxOne events:', e);
}

// console.log('[FOX One Events]: All filtered events', events);
return events;
  };
 //// >--- End of replacement code --- //// 

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
//      console.log('FOX One entitlements:', this.entitlements);

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
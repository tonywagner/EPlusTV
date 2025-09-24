import axios from 'axios';
import moment from 'moment';

import {userAgent} from './user-agent';
import {IEntry, IProvider, TChannelPlaybackInfo} from './shared-interfaces';
import {db} from './database';
import {debug} from './debug';
import {normalTimeRange} from './shared-helpers';

interface IHudlEvent {
  id: string;
  site_id: string;
  site_title: string;
  section_title: string;
  title: string;
  description: string;
  date: string;
  expected_duration: number;
  large_image: string;
  shared_sites: string[];
}

interface IHudlConference {
  slug: string;
  short_name: string;
  full_name: string;
  enabled?: boolean;
}

interface IHudlSite {
  id: string;
  title: string;
  slug: string;
  conference_short_name: string;
}

export interface IHudlMeta {
  conferences: IHudlConference[];
  sites: IHudlSite[];
}

// to add or remove a conference, update this array
// slug must exactly match the URL slug used to look up sites and events
// short_name (acronym) and full_name can be anything
// UI alphabetizes them based on short_name
const all_conferences = [
  {
    short_name: 'ARC',
    full_name: 'American Rivers Conference',
    slug: 'americanriverssportsnetwork',
  },
  {
    short_name: 'CCIW',
    full_name: 'College Conference of Illinois and Wisconsin',
    slug: 'CCIW',
  },
  {
    short_name: 'Centennial Conference',
    full_name: 'Centennial Conference',
    slug: 'Centennial',
  },
  {
    short_name: 'CIAA',
    full_name: 'Central Intercollegiate Athletic Association',
    slug: 'ciaa',
  },
  {
    short_name: 'Conference Carolinas',
    full_name: 'Conference Carolinas',
    slug: 'conferencecarolinas',
  },
  {
    short_name: 'CNE',
    full_name: 'Conference of New England',
    slug: 'cccnetwork',
  },
  {
    short_name: 'Empire 8',
    full_name: 'Empire 8 Athletic Conference',
    slug: 'empire8network',
  },
  {
    short_name: 'G-MAC',
    full_name: 'Great Midwest Athletic Conference',
    slug: 'gmdn',
  },
  {
    short_name: 'GLVC',
    full_name: 'Great Lakes Valley Conference',
    slug: 'glvc',
  },
  {
    short_name: 'GNAC',
    full_name: 'Great Northeast Athletic Conference',
    slug: 'gnac',
  },
  {
    short_name: 'GPAC',
    full_name: 'Great Plains Athletic Conference',
    slug: 'gpacnetwork',
  },
  {
    short_name: 'HAAC',
    full_name: 'Heart of America Athletic Conference',
    slug: 'hoa',
  },
  {
    short_name: 'ICCAC',
    full_name: 'Iowa Community College Athletic Conference',
    slug: 'IowaCommunityCollegeAthleticConference',
  },
  {
    short_name: 'KCAC',
    full_name: 'Kansas Collegiate Athletic Conference',
    slug: 'kcacnetwork',
  },
  {
    short_name: 'LSC',
    full_name: 'Lone Star Conference',
    slug: 'lonestar',
  },
  {
    short_name: 'MAC',
    full_name: 'Middle Atlantic Conference',
    slug: 'MAC',
  },
  {
    short_name: 'MASCAC',
    full_name: 'Massachusetts State Collegiate Athletic Conference',
    slug: 'mascac',
  },
  {
    short_name: 'MEC',
    full_name: 'Mountain East Conference',
    slug: 'mec',
  },
  {
    short_name: 'MIAA',
    full_name: 'Mid-America Intercollegiate Athletics Association',
    slug: 'miaa',
  },
  {
    short_name: 'MIAC',
    full_name: 'Minnesota Intercollegiate Athletic Conference',
    slug: 'MIAC',
  },
  {
    short_name: 'NCAC',
    full_name: 'North Coast Athletic Conference',
    slug: 'ncac',
  },
  {
    short_name: 'NEWMAC',
    full_name: `New England Women's and Men's Athletic Conference`,
    slug: 'NEWMAC',
  },
  {
    short_name: 'NSIC',
    full_name: 'Northern Sun Intercollegiate Conference',
    slug: 'NSIC',
  },
  {
    short_name: 'NWC',
    full_name: 'Northwest Conference',
    slug: 'northwestconferencenetwork',
  },
  {
    short_name: 'ODAC',
    full_name: 'Old Dominion Athletic Conference',
    slug: 'odacsn',
  },
  {
    short_name: 'PAC',
    full_name: `Presidents' Athletic Conference`,
    slug: 'PresidentsAthleticConference',
  },
  {
    short_name: 'PACWest',
    full_name: 'Pacific West Conference',
    slug: 'pacwest',
  },
  {
    short_name: 'PSAC',
    full_name: 'Pennsylvania State Athletic Conference',
    slug: 'PSACNetwork',
  },
  {
    short_name: 'RMAC',
    full_name: 'Rocky Mountain Athletic Conference',
    slug: 'rmacnetwork',
  },
  {
    short_name: 'SAC',
    full_name: 'Sooner Athletic Conference',
    slug: 'sooner',
  },
  {
    short_name: 'SCIAC',
    full_name: 'Southern California Intercollegiate Athletic Conference',
    slug: 'SCIACNETWORK',
  },
  {
    short_name: 'SIAC',
    full_name: 'Southern Intercollegiate Athletic Conference',
    slug: 'siac',
  },
  {
    short_name: 'TSC',
    full_name: 'The Sun Conference',
    slug: 'TheSunConference',
  },
  {
    short_name: 'UMAC',
    full_name: 'Upper Midwest Athletic Conference',
    slug: 'umacsportsnetwork',
  },
  {
    short_name: 'WIAC',
    full_name: 'Wisconsin Intercollegiate Athletic Conference',
    slug: 'WIAC',
  },
];

const filterSiteTitle = (site_title: string): string => {
  return site_title.replace(/(University|College|University of|The University of|College of|The College of)/gi, '').trim();
};

const parseAirings = async (events: IHudlEvent[], sites: IHudlSite[]) => {
  const [now, endSchedule] = normalTimeRange();

  for (const event of events) {
    if (!event || !event.id) {
      continue;
    }

    const entryExists = await db.entries.findOneAsync<IEntry>({id: `hudl-${event.id}`});

    if (!entryExists) {
      const start = moment(event.date);
      if (!event.expected_duration) {
        event.expected_duration = 3 * 60 * 60;
      }
      const end = moment(event.date).add(event.expected_duration, 'seconds').add(1, 'hours');
      const originalEnd = moment(event.date).add(event.expected_duration, 'seconds');

      if (end.isBefore(now) || start.isAfter(endSchedule)) {
        continue;
      }
      
      let conference_short_name = 'Hudl';
      let title = event.title.trim();
      const site = sites.find(obj => obj.id == event.site_id);
      const shared_site = sites.find(obj => obj.slug == event.shared_sites[0]);
      if (site) {
        conference_short_name = site.conference_short_name;
        if (shared_site && (event.shared_sites.length == 1)) {
          title = shared_site.title + ' vs. ' + site.title;
        } else {
          if ( !event.title.includes(filterSiteTitle(site.title)) ) {
            title += ' (' + site.title + ')';
          }
        }
      } else if (shared_site) {
        conference_short_name = shared_site.conference_short_name;
        if ( !event.title.includes(filterSiteTitle(shared_site.title)) ) {
          title += ' (' + shared_site.title + ')';
        }
      }

      console.log('Adding event: ', title);

      await db.entries.insertAsync<IEntry>({
        categories: [...new Set([conference_short_name, event.section_title])],
        duration: end.diff(start, 'seconds'),
        end: end.valueOf(),
        from: 'hudl',
        id: `hudl-${event.id}`,
        image: event.large_image,
        name: title,
        network: conference_short_name,
        originalEnd: originalEnd.valueOf(),
        sport: event.section_title,
        start: start.valueOf(),
      });
    }
  }
};

class HudlHandler {
  public initialize = async () => {
    const setup = (await db.providers.countAsync({name: 'hudl'})) > 0 ? true : false;

    // First time setup
    if (!setup) {
      await db.providers.insertAsync<IProvider>({
        enabled: false,
        meta: {
          conferences: all_conferences,
          sites: [],
        },
        name: 'hudl',
      });
    }

    const {enabled, meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});
    
    // added conferences
    const new_conferences = all_conferences.filter(
      (a) => !meta.conferences.some((b) => a.slug === b.slug),
    );
    meta.conferences.push(...new_conferences);
    
    // removed conferences
    meta.conferences = meta.conferences.filter(
      (a) => all_conferences.some((b) => a.slug === b.slug),
    );
    
    // sort
    this.saveConferences(meta.conferences);

    if (!enabled) {
      return;
    }
  };

  public getSchedule = async (): Promise<void> => {
    const {enabled, meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});

    if (!enabled) {
      return;
    }

    console.log('Looking for Hudl events...');
    
    const [now, inTwoDays] = normalTimeRange();
    
    if ( meta.sites && (meta.sites.length > 0) ) {
      try {
        const max_items_per_page = 100;
        let pages = 1;
          
        for (let page = 1; page <= pages; page++) {
          const broadcasts_url = [
            'https://',
            'vcloud.hudl.com',
            '/api/viewer/',
            'broadcast',
            '?include_deletions=0',
            '&page=',
            page,
            '&per_page=',
            max_items_per_page,
            '&site_id=',
            encodeURIComponent(meta.sites.map((s) => s.id).join(',')),
            '&before=',
            encodeURIComponent(moment(inTwoDays).add(1, 'day').format('ddd, DD MMM YYYY')),
            '&viewer_status=3&sort_by=date&sort_dir=asc',
          ].join('');
            
          const {data: broadcasts_data} = await axios.get(broadcasts_url, {
            headers: {
              'user-agent': userAgent,
            },
          });
          
          if ( broadcasts_data.num_pages ) {
            pages = broadcasts_data.num_pages;
          }
          
          debug.saveRequestData(broadcasts_data, 'hudl', 'epg');
          await parseAirings(broadcasts_data.broadcasts, meta.sites);
        }
      } catch (e) {
        console.error(e);
        console.log(`Could not parse Hudl events`);
      }
    } else {
      console.log(`Found no Hudl sites`);
    }
  };

  public getEventData = async (eventId: string): Promise<TChannelPlaybackInfo> => {
    const id = eventId.replace('hudl-', '');

    try {
      const streamUrl = await this.getStream(id);

      return [streamUrl, {'user-agent': userAgent}];
    } catch (e) {
      console.error(e);
      console.log('Could not start playback');
    }
  };

  private getStream = async (eventId: string): Promise<string> => {
    try {
      const url = ['https://', 'vcloud.hudl.com', '/file/broadcast/', `/${eventId}`, '.m3u8', '?hfr=1'].join('');

      return url;
    } catch (e) {
      console.error(e);
      console.log('Could not get stream');
    }
  };

  private saveConferences = async (conferences: IHudlConference[]) => {
    // sort
    conferences.sort((a, b) => a.short_name.localeCompare(b.short_name));
    
    // save
    await db.providers.updateAsync<IProvider, any>({name: 'hudl'}, {$set: {'meta.conferences': conferences}});
  };
  
  public updateConference = async (conference: IHudlConference): Promise<void> => {
    // get currently stored conferences
    const {meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});
    
    // find requested conference by slug
    const matchingConference = meta.conferences.filter(obj => obj.slug === conference.slug);
    
    // filter it out
    meta.conferences = meta.conferences.filter(
      (a) => !matchingConference.some((b) => a.slug === b.slug),
    );
    
    // add back the updated conference
    meta.conferences.push(...[conference]);
    
    // save
    this.saveConferences(meta.conferences);
  }
  
  public updateConferenceSites = async (conference: IHudlConference): Promise<void> => {
    console.log(`Updating sites for Hudl ${conference.short_name}...`);
    
    try {
      // get currently stored sites
      const {meta} = await db.providers.findOneAsync<IProvider>({name: 'hudl'});
      
      // if enabled, fetch the sites
      if (conference.enabled) {
        const config_url = [
          'https://',
          'apps.blueframetech.com',
          '/api/v1/',
          'bft/',
          conference.slug,
          '/config.json',
        ].join('');
          
        const {data: config_data} = await axios.get(config_url, {
          headers: {
            'user-agent': userAgent,
          },
        });
         
        const sites_url = [
          'https://',
          'vcloud.hudl.com',
          '/api/viewer/',
          'site?site_ids=',
          config_data.vCloud.siteIds.join(','),
          '&per_page=100&page=1',
        ].join('');
            
        const {data: sites_data} = await axios.get(sites_url, {
          headers: {
            'user-agent': userAgent,
          },
        });
              
        const sites: IHudlSite[] = sites_data.sites.map(item => ({
          id: item.id,
          title: item.title,
          slug: item.slug,
          conference_short_name: conference.short_name,
        }));
        
        console.log(`Adding ${sites.length} new sites`);
        
        // add the new sites
        meta.sites.push(...sites);
        
      // if disabled, remove the sites
      } else {
        
        // find requested sites by conference_short_name
        const matchingSites = meta.sites.filter(obj => obj.conference_short_name === conference.short_name);
        
        console.log(`Removing ${matchingSites.length} sites`);
        
        // filter them out
        meta.sites = meta.sites.filter(
          (a) => !matchingSites.some((b) => a.id == b.id),
        );
      }
    
      // save
      await db.providers.updateAsync<IProvider, any>({name: 'hudl'}, {$set: {'meta.sites': meta.sites}});
    } catch (e) {
      console.error(e);
      console.log(`Could not update sites for Hudl ${conference.short_name}`);
    }
  }
}

export const hudlHandler = new HudlHandler();

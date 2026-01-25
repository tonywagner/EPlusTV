import _ from 'lodash';
import xml from 'xml';
import moment from 'moment';

import {db} from './database';
import {calculateChannelFromName, CHANNELS} from './channels';
import {IEntry} from './shared-interfaces';
import {getLinearStartChannel, getNumberOfChannels, getStartChannel, xmltvPadding} from './misc-db-service';

const baseCategories = ['HD', 'HDTV', 'Sports event', 'Sports', 'E+TV', 'EPlusTV'];

export const usesMultiple = async (): Promise<boolean> => {
  const enabledProviders = await db.providers.countAsync({enabled: true});

  return enabledProviders > 1;
};

export const formatEntryName = (entry: IEntry, usesMultiple: boolean): string => {
  let entryName = entry.name;

  if (entry.feed) {
    entryName = `${entryName} (${entry.feed})`;
  }

  if (usesMultiple && !entry.linear) {
    entryName = `${entryName} - ${entry.network}`;
  }

  if (entry.sport && !entry.linear) {
    entryName = `${entry.sport} - ${entryName}`;
  }

  return entryName;
};

const formatCategories = (categories: string[] = []) =>
  [...new Set([...baseCategories, ...categories])].map(category => ({
    category: [
      {
        _attr: {
          lang: 'en',
        },
      },
      category,
    ],
  }));

export const generateXml = async (linear = false): Promise<xml> => {
  const startChannel = await getStartChannel();
  const numOfChannels = await getNumberOfChannels();
  const linearStartChannel = await getLinearStartChannel();
  const xmltvPadded = await xmltvPadding();

  const wrap: any = {
    tv: [
      {
        _attr: {
          'generator-info-name': 'eplustv',
        },
      },
    ],
  };

  const useMultiple = await usesMultiple();

  if (linear) {
    for (const key in CHANNELS.MAP) {
      const val = CHANNELS.MAP[key];

      if (val.checkChannelEnabled) {
        const enabled = await val.checkChannelEnabled();

        if (!enabled) {
          continue;
        }
      }

      const channelNum = parseInt(key, 10) + linearStartChannel;

      wrap.tv.push({
        channel: [
          {
            _attr: {
              id: `${channelNum}.eplustv`,
            },
          },
          {
            'display-name': [
              {
                _attr: {
                  lang: 'en',
                },
              },
              val.name,
            ],
          },
          {
            icon: [
              {
                _attr: {
                  src: val.logo,
                },
              },
            ],
          },
        ],
      });
    }
  } else {
    _.times(numOfChannels, i => {
      const channelNum = startChannel + i;

      wrap.tv.push({
        channel: [
          {
            _attr: {
              id: `${channelNum}.eplustv`,
            },
          },
          {
            'display-name': [
              {
                _attr: {
                  lang: 'en',
                },
              },
              `EPlusTV ${channelNum}`,
            ],
          },
          {
            icon: [
              {
                _attr: {
                  src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAtAAAAIcCAYAAADffZlTAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAylpVFh0WE1MOmNvbS5hZG9iZS54bXAAAAAAADw/eHBhY2tldCBiZWdpbj0i77u/IiBpZD0iVzVNME1wQ2VoaUh6cmVTek5UY3prYzlkIj8+IDx4OnhtcG1ldGEgeG1sbnM6eD0iYWRvYmU6bnM6bWV0YS8iIHg6eG1wdGs9IkFkb2JlIFhNUCBDb3JlIDkuMS1jMDAzIDc5Ljk2OTBhODdmYywgMjAyNS8wMy8wNi0yMDo1MDoxNiAgICAgICAgIj4gPHJkZjpSREYgeG1sbnM6cmRmPSJodHRwOi8vd3d3LnczLm9yZy8xOTk5LzAyLzIyLXJkZi1zeW50YXgtbnMjIj4gPHJkZjpEZXNjcmlwdGlvbiByZGY6YWJvdXQ9IiIgeG1sbnM6eG1wPSJodHRwOi8vbnMuYWRvYmUuY29tL3hhcC8xLjAvIiB4bWxuczp4bXBNTT0iaHR0cDovL25zLmFkb2JlLmNvbS94YXAvMS4wL21tLyIgeG1sbnM6c3RSZWY9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC9zVHlwZS9SZXNvdXJjZVJlZiMiIHhtcDpDcmVhdG9yVG9vbD0iQWRvYmUgUGhvdG9zaG9wIDI2LjEwIChNYWNpbnRvc2gpIiB4bXBNTTpJbnN0YW5jZUlEPSJ4bXAuaWlkOjc0QjE1RUY4OTExMzExRjBBMjY5ODA3ODc4ODM3ODMyIiB4bXBNTTpEb2N1bWVudElEPSJ4bXAuZGlkOjc0QjE1RUY5OTExMzExRjBBMjY5ODA3ODc4ODM3ODMyIj4gPHhtcE1NOkRlcml2ZWRGcm9tIHN0UmVmOmluc3RhbmNlSUQ9InhtcC5paWQ6RTk2Nzk0ODk5MTBDMTFGMEEyNjk4MDc4Nzg4Mzc4MzIiIHN0UmVmOmRvY3VtZW50SUQ9InhtcC5kaWQ6RTk2Nzk0OEE5MTBDMTFGMEEyNjk4MDc4Nzg4Mzc4MzIiLz4gPC9yZGY6RGVzY3JpcHRpb24+IDwvcmRmOlJERj4gPC94OnhtcG1ldGE+IDw/eHBhY2tldCBlbmQ9InIiPz5Xn3tVAAA6yklEQVR42uzdB/QkVZU44DvDkHNWRjKIiIqCIIiKKBjWHBcxLMY1rHl3jWva/5rzmjGgriJrwIAiJswiCAgGQF0QAclpGGCGSf8q+81xHGd+obuq3uvq7zvnHRFmuruquqpvvbrv3jkrVqwIAABgZubaBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAAATQAAAigAQBAAA0AAAJoAAAQQNsFAAAggAYAAAE0AAAIoAEAQAANAAACaAAAEEDbBQAAIIAGAAABNAAACKABAEAADQAAAmgAABBA2wUAACCABgAA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DQAACKABAEAADQAAAmgAABBAAwCAABoAAATQAACAABoAAATQAAAggAYAAAE0AAAIoAEAQAANAAAIoAEAQAANAAACaAAAEEADAIAAGgAABNAAAIAAGgAABNAAACCABgAAATQAAAigAQBAAA0AAAigAQBAAA0AAAJoAAAQQAMAgAAaAAAE0AAAgAAaAAAE0AAAIIAGAAABNAAACKABAEAADQAACKABAEAADQAAAmgAABBAAwCAABoAAATQAACAABoAAATQAAAggAYAAAE0AAAIoAEAQAANAAAIoAEAQAANAAACaAAAEEADAIAAGgAABNAAAIAAGgAABNAAACCABgAAATQAAAigAQBAAA0AAAigAQBAAA0AAAJoAAAQQAMAgAAaAAAE0AAAgAAaAAAE0AAAIIAGAAABNAAACKABAEAADQAACKABAEAADQAAAmgAABBAAwCAABoAAATQAACAABoAAATQAAAggAYAAAE0AAAIoAEAQAANAAAIoAEAQAANAAACaAAAEEADAIAAGgAABNAAAIAAGgAABNAAACCABgAAATQAAAigAQBAAA0AAAigAQBAAA0AAAJoAAAQQAMAgAAaAAAE0AAAgAAaAAAE0AAAIIAGAAABNAAACKABAEAADQAACKABAEAADQAAAmgAABBAAwCAABoAAATQAACAABoAAATQAAAggAYAAAE0AAAIoAEAQAANAAAIoAEAQAANAAACaAAAEEADAIAAGgAABNAAAIAAGgAABNAAACCABgAAATQAAAigAQBAAA0AAAigAQBAAA0AAAJoAAAQQAMAgAAaAAAE0AAAgAAaAAAE0AAAIIAGAAABNAAACKABAEAADQAATOP/CzAAbRNxenYyiPAAAAAASUVORK5CYII=',
                },
              },
            ],
          },
        ],
      });
    });
  }

  const scheduledEntries = await db.entries
    .findAsync<IEntry>({channel: {$exists: true}, linear: linear ? true : {$exists: false}})
    .sort({start: 1});

  for (const entry of scheduledEntries) {
    const channelNum = await calculateChannelFromName(`${entry.channel}`);

    const entryName = formatEntryName(entry, useMultiple);

    const end = xmltvPadded || !entry.originalEnd ? entry.end : entry.originalEnd;

    wrap.tv.push({
      programme: [
        {
          _attr: {
            channel: `${channelNum}.eplustv`,
            start: moment(entry.start).format('YYYYMMDDHHmmss ZZ'),
            stop: moment(end).format('YYYYMMDDHHmmss ZZ'),
          },
        },
        {
          title: [
            {
              _attr: {
                lang: 'en',
              },
            },
            entryName,
          ],
        },
        {
          video: {
            quality: 'HDTV',
          },
        },
        {
          desc: [
            {
              _attr: {
                lang: 'en',
              },
            },
            entryName,
          ],
        },
        {
          icon: [
            {
              _attr: {
                src: entry.image,
              },
            },
          ],
        },
        {
          live: [{}, ''],
        },
        ...(!entry.replay
          ? [
              {
                new: [{}, ''],
              },
            ]
          : []),
        ...formatCategories(entry.categories),
      ],
    });
  }

  return xml(wrap);
};

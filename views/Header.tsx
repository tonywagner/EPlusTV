import type {FC} from 'hono/jsx';

import {version} from '../package.json';

import {latestRelease} from '@/services/shared-helpers';

export const Header: FC = async () => {
  const latest_release = await latestRelease();
  let latestLabel = 'latest';
  if ( latest_release && (latest_release != '') && (version != latest_release.slice(1)) ) {
    latestLabel = [latestLabel, latest_release].join(' ');
  }
  
  return (
    <header class="container">
      <div class="grid-container">
        <h1>
          <span class="title">
            <span>E+</span>
            <span class="title-bold">TV</span>
          </span>
        </h1>
        <div class="align-center">
          <p>v{version} ({latestLabel})</p>
        </div>
      </div>
    </header>
  );
};

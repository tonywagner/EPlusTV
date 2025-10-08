import type {FC} from 'hono/jsx';

import {version} from '../package.json';

import {latestRelease} from '@/services/shared-helpers';

export const Header: FC = async () => {
  const latestVersion = await latestRelease();
  let latestLabel = 'latest';
  if ( version != latestVersion.slice(1) ) {
    latestLabel = [latestLabel, latestVersion].join(' ');
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

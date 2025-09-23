import {FC} from 'hono/jsx';

import {foxOneHandler} from '@/services/foxone-handler';

interface ILogin {
  code?: string;
  deviceToken?: string;
}

export const Login: FC<ILogin> = async ({code}) => {
  let shownCode = code;

  if (!shownCode) {
    shownCode = await foxOneHandler.getAuthCode();
  }

  return (
    <div hx-target="this" hx-swap="outerHTML" hx-trigger="every 5s" hx-get={`/providers/foxone/tve-login/${shownCode}`}>
      <div class="grid-container">
        <div>
          <h5>FOX One Login:</h5>
          <span>
            Open this link and follow instructions:
            <br />
            <a href="https://go.fox.com" target="_blank">
              https://fox.com
            </a>
          </span>
          <h6>Code: {shownCode}</h6>
        </div>
        <div aria-busy="true" style="align-content: center" />
      </div>
    </div>
  );
};

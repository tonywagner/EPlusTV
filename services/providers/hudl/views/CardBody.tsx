import {FC} from 'hono/jsx';

import {IHudlMeta} from '@/services/hudl-handler';

interface IHudlBodyProps {
  enabled: boolean;
  open?: boolean;
  meta: IHudlMeta;
}

export const HudlBody: FC<IHudlBodyProps> = ({enabled, open, meta}) => {
  if (!enabled) {
    return <></>;
  }

  return (
    <div hx-swap="outerHTML" hx-target="this">
      <summary>
        <span>Conferences</span>
      </summary>
      <table class="striped">
        <thead>
          <tr>
            <th></th>
            <th scope="col">Name</th>
          </tr>
        </thead>
        <tbody>
          {meta.conferences.map(c => (
            <tr key={c.short_name}>
              <td>
                <input
                  hx-target="this"
                  hx-swap="outerHTML"
                  type="checkbox"
                  checked={c.enabled}
                  data-enabled={c.enabled ? 'true' : 'false'}
                  hx-put={`/providers/hudl/conferences/toggle/${c.short_name}`}
                  hx-trigger="change"
                  name="conference-enabled"
                />
              </td>
              <td>{c.short_name} {(c.full_name == c.short_name) ? '' : (' (' + c.full_name + ')')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

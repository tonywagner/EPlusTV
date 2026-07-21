import {FC} from 'hono/jsx';

interface ILoginProps {
  invalid?: boolean;
}

export const Login: FC<ILoginProps> = async ({invalid}) => {
  return (
    <div hx-target="this" hx-swap="outerHTML">
      <form hx-post="/providers/bzzr/login" hx-trigger="submit" id="bzzr-login-form">
        <fieldset class="grid">
          <input
            {...(invalid && {
              'aria-describedby': 'invalid-helper',
              'aria-invalid': 'true',
            })}
            name="email"
            id="bzzr-email"
            placeholder="Email"
            aria-label="Email"
          />
          <input
            {...(invalid && {
              'aria-describedby': 'invalid-helper',
              'aria-invalid': 'true',
            })}
            id="bzzr-password"
            type="password"
            name="password"
            placeholder="Password"
            aria-label="Password"
          />
          <button type="submit" id="bzzr-login">
            Log in
          </button>
        </fieldset>
        {invalid && <small id="invalid-helper">Login failed. Please try again.</small>}
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            var form = document.getElementById('bzzr-login-form');

            if (form) {
              form.addEventListener('htmx:beforeRequest', function() {
                this.querySelector('#bzzr-login').setAttribute('aria-busy', 'true');
                this.querySelector('#bzzr-login').setAttribute('aria-label', 'Loading…');
                this.querySelector('#bzzr-email').disabled = true;
                this.querySelector('#bzzr-password').disabled = true;
              });
            }
          `,
        }}
      />
    </div>
  );
};

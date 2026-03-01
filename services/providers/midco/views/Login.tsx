import {FC} from 'hono/jsx';

interface ILoginProps {
  invalid?: boolean;
}

export const Login: FC<ILoginProps> = async ({invalid}) => {
  return (
    <div hx-target="this" hx-swap="outerHTML">
      <form hx-post="/providers/midco/login" hx-trigger="submit" id="midco-login-form">
        <fieldset class="grid">
          <input
            {...(invalid && {
              'aria-describedby': 'invalid-helper',
              'aria-invalid': 'true',
            })}
            name="email"
            id="midco-email"
            placeholder="Email"
            aria-label="Email"
          />
          <input
            {...(invalid && {
              'aria-describedby': 'invalid-helper',
              'aria-invalid': 'true',
            })}
            id="midco-password"
            type="password"
            name="password"
            placeholder="Password"
            aria-label="Password"
          />
          <button type="submit" id="midco-login">
            Log in
          </button>
        </fieldset>
        {invalid && <small id="invalid-helper">Login failed. Please try again.</small>}
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            var form = document.getElementById('midco-login-form');

            if (form) {
              form.addEventListener('htmx:beforeRequest', function() {
                this.querySelector('#midco-login').setAttribute('aria-busy', 'true');
                this.querySelector('#midco-login').setAttribute('aria-label', 'Loading…');
                this.querySelector('#midco-email').disabled = true;
                this.querySelector('#midco-password').disabled = true;
              });
            }
          `,
        }}
      />
    </div>
  );
};

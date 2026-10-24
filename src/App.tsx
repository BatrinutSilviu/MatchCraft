import { useHashRoute, useStore } from './store';
import { Home } from './components/Home';
import { Landing } from './components/Landing';
import { AuthPage } from './components/AuthPage';
import { CreateWizard } from './components/CreateWizard';
import { PublicView, TournamentPage } from './components/TournamentView';
import { UserMenu } from './components/UserMenu';
import { ForgotPage, ResetPage, VerifyBanner, VerifyPage } from './components/AccountPages';
import { InvitePage } from './components/InvitePage';

export function App() {
  const route = useHashRoute();
  const { auth, error, dismissError } = useStore();
  const [path, query = ''] = route.split(/\?(.*)/s);
  const params = new URLSearchParams(query);
  const next = params.get('next') ?? '/';
  const token = params.get('token') ?? '';
  const email = params.get('email') ?? undefined;

  const page = () => {
    // Pages reached from a link work whether or not you're logged in.
    const shared = path.match(/^\/s\/([^/]+)/);
    if (shared) return <PublicView shareId={shared[1]} />;
    if (path === '/verify') return <VerifyPage key={token} token={token} />;
    if (path === '/reset') return <ResetPage token={token} />;
    if (auth.status === 'loading') return <div className="loading" aria-label="Loading" />;
    if (path === '/invite') return <InvitePage key={`${token}-${auth.status}`} token={token} />;

    if (auth.status === 'out') {
      if (path === '/login') return <AuthPage key="login" mode="login" next={next} email={email} />;
      if (path === '/signup') return <AuthPage key="signup" mode="signup" next={next} email={email} />;
      if (path === '/forgot') return <ForgotPage />;
      if (path === '/new') return <AuthPage mode="signup" next="/new" note="Create a free account so your tournament is saved." />;
      if (path.startsWith('/t/')) return <AuthPage mode="login" next={path} />;
      return <Landing />;
    }
    const owned = path.match(/^\/t\/([^/]+)/);
    if (owned) return <TournamentPage id={owned[1]} />;
    if (path === '/new') return <CreateWizard />;
    return <Home />;
  };

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span className="brand-mark">🏆</span> Matchcraft
        </a>
        <div className="row">
          {auth.status === 'in' && <a href="#/new" className="btn btn-primary btn-sm">+<span className="hide-sm"> New tournament</span></a>}
          {auth.status === 'in' ? <UserMenu user={auth.user} /> : auth.status === 'out' && path !== '/login' && (
            <a href="#/login" className="btn btn-sm">Log in</a>
          )}
        </div>
      </header>
      {auth.status === 'in' && !auth.user.emailVerified && path !== '/verify' && (
        <VerifyBanner key={auth.user.id} email={auth.user.email} />
      )}
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-btn" onClick={dismissError} aria-label="Dismiss">✕</button>
        </div>
      )}
      <main className="page">{page()}</main>
    </div>
  );
}

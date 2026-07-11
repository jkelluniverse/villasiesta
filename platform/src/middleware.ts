import { withAuth } from 'next-auth/middleware';

// Protect the portal; unauthenticated visitors are sent to our login page.
export default withAuth({ pages: { signIn: '/owner/login' } });

// /owner/login is intentionally excluded so guests can sign in.
export const config = {
  matcher: ['/owner', '/owner/((?!login).*)'],
};

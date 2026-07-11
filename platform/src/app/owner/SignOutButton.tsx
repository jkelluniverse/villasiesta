'use client';
import { signOut } from 'next-auth/react';

export default function SignOutButton() {
  return <button className="signout" onClick={() => signOut({ callbackUrl: '/owner/login' })}>Sign out</button>;
}

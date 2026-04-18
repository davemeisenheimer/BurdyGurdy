import { useState } from 'react';
import { supabase } from '../../lib/supabase';

interface Props {
  onClose: () => void;
}

export function PasswordResetDialog({ onClose }: Props) {
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [done,            setDone]            = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword.length < 6)          { setError('Password must be at least 6 characters.'); return; }
    setLoading(true);
    setError(null);
    const { error: supabaseError } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (supabaseError) setError(supabaseError.message);
    else               setDone(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-sky-50 rounded-2xl shadow-xl border border-slate-200 w-full max-w-sm p-6">
        <p className="font-semibold text-slate-800 text-base mb-4">Set new password</p>

        {done ? (
          <>
            <div className="text-center py-2 mb-4">
              <img src="/favicon.png" className="w-14 h-14 mx-auto mb-4 opacity-90" aria-hidden="true" />
              <p className="text-green-600 font-semibold mb-1">Password updated</p>
              <p className="text-sm text-slate-500">Your password has been changed successfully.</p>
            </div>
            <div className="flex justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-white bg-forest-600 rounded-xl hover:bg-forest-700 transition-colors"
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="space-y-3 mb-4">
              <input
                type="password"
                placeholder="New password"
                value={newPassword}
                onChange={e => { setNewPassword(e.target.value); setError(null); }}
                required
                minLength={6}
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
              <input
                type="password"
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={e => { setConfirmPassword(e.target.value); setError(null); }}
                required
                className="w-full px-3 py-2.5 border border-slate-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-sky-100 border border-sky-200 rounded-xl hover:bg-sky-200 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-sm font-medium text-white bg-forest-600 rounded-xl hover:bg-forest-700 transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving…' : 'Update password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

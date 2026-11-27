export function CustomerEmailVerificationControl({
  email,
  emailVerifiedAt,
}: {
  email: string;
  emailVerifiedAt: string | null;
}) {
  if (emailVerifiedAt) {
    return (
      <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
        <p className="text-sm font-semibold text-emerald-900">Email verified</p>
        <p className="mt-1 text-xs text-emerald-800">
          The email address for {email} is verified.
        </p>
      </div>
    );
  }

  return (
    <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold text-amber-950">
        Email not yet verified
      </h2>
      <p className="mt-1 text-sm leading-5 text-amber-900">
        You can issue a portal invitation to {email} without a separate code.
        The address will be verified when the customer accepts the invitation
        and sets a password.
      </p>
    </section>
  );
}

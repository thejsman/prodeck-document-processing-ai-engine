export default function NotFound() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        textAlign: 'center',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        color: '#111',
        background: '#fafafa',
      }}
    >
      <h1 style={{ fontSize: '2rem', fontWeight: 600, margin: 0 }}>Microsite not found</h1>
      <p style={{ marginTop: '0.75rem', color: '#666', fontSize: '0.95rem', maxWidth: 420 }}>
        This subdomain hasn&apos;t been published yet, or it may have been removed.
      </p>
    </main>
  );
}

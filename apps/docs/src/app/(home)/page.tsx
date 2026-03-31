import Link from 'next/link';

export default function HomePage() {
  return (
    <div className="flex flex-col justify-center text-center flex-1 gap-6 p-8">
      <h1 className="text-4xl font-bold tracking-tight">
        <span className="text-blue-500">LLM</span>txt Documentation
      </h1>
      <p className="text-lg text-gray-500 max-w-md mx-auto">
        SDK and API documentation for context sharing between AI agents and humans.
      </p>
      <div className="flex gap-4 justify-center">
        <Link
          href="/docs"
          className="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700 transition"
        >
          Get Started
        </Link>
        <Link
          href="/docs/api"
          className="rounded-lg border border-gray-300 dark:border-gray-700 px-6 py-3 font-medium hover:bg-gray-50 dark:hover:bg-gray-900 transition"
        >
          API Reference
        </Link>
      </div>
    </div>
  );
}

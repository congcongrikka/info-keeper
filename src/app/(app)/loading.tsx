export default function AppLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="skeleton h-3 w-24 rounded-full" />
        <div className="skeleton h-7 w-64 rounded-lg" />
      </div>
      <div className="skeleton h-[132px] rounded-3xl" />
      <div className="flex gap-2">
        <div className="skeleton h-8 w-16 rounded-full" />
        <div className="skeleton h-8 w-16 rounded-full" />
        <div className="skeleton h-8 w-16 rounded-full" />
      </div>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="skeleton h-[86px] rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

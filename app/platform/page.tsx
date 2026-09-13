import { listPlatformRestaurants } from "@/app/actions/platformAdmin";
import { RestaurantManager } from "@/components/platform/RestaurantManager";

export default async function PlatformRestaurantsPage() {
  const result = await listPlatformRestaurants();

  if (!result.ok) {
    return <p className="text-sm text-red-700">{result.message}</p>;
  }

  return <RestaurantManager initialRestaurants={result.data} />;
}

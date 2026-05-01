import { useEffect, useState } from "react";
import {
  getLastDataSource,
  subscribeDataSource,
  type DataSourceEvent,
} from "@/integrations/data/source-telemetry";

/**
 * Acompanha qual backend serviu a última leitura de dados.
 * Útil para badges/observabilidade no shell desktop.
 */
export function useDataSource(): DataSourceEvent | null {
  const [ev, setEv] = useState<DataSourceEvent | null>(() => getLastDataSource());
  useEffect(() => subscribeDataSource(setEv), []);
  return ev;
}

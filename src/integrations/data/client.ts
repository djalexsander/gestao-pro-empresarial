/**
 * ============================================================================
 * dataClient - ponto unico de acesso a dados do app
 * ============================================================================
 *
 * Arquitetura cloud-only: todos os dominios leem e gravam pela API/Supabase
 * remoto. Nao ha fallback local, outbox ou selecao dinamica de adapter.
 */

import type { DataAdapter } from "./adapter";
import { cloudAdapter } from "./adapters/cloud";

export const dataClient: DataAdapter = cloudAdapter;

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      categorias_financeiras: {
        Row: {
          ativo: boolean
          cor: string | null
          created_at: string
          id: string
          nome: string
          owner_id: string
          parent_id: string | null
          tipo: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string | null
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          parent_id?: string | null
          tipo: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string | null
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          parent_id?: string | null
          tipo?: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_financeiras_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias_financeiras"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_produto: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          nome: string
          owner_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          owner_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          owner_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_produto_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          bairro: string | null
          celular: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          created_at: string
          data_nascimento: string | null
          documento: string | null
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          nome: string
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          owner_id: string
          status: Database["public"]["Enums"]["cadastro_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          data_nascimento?: string | null
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          data_nascimento?: string | null
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id?: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      compra_itens: {
        Row: {
          compra_id: string
          created_at: string
          desconto: number
          descricao: string | null
          id: string
          lote_id: string | null
          owner_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          total: number
          updated_at: string
          variacao_id: string | null
        }
        Insert: {
          compra_id: string
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id: string
          preco_unitario?: number
          produto_id: string
          quantidade: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Update: {
          compra_id?: string
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compra_itens_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      compras: {
        Row: {
          created_at: string
          data_emissao: string
          data_prevista: string | null
          data_recebimento: string | null
          desconto: number
          fornecedor_id: string | null
          frete: number
          id: string
          numero: string
          numero_nf: string | null
          observacoes: string | null
          outros: number
          owner_id: string
          serie_nf: string | null
          status: Database["public"]["Enums"]["compra_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_emissao?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          desconto?: number
          fornecedor_id?: string | null
          frete?: number
          id?: string
          numero: string
          numero_nf?: string | null
          observacoes?: string | null
          outros?: number
          owner_id: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["compra_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_emissao?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          desconto?: number
          fornecedor_id?: string | null
          frete?: number
          id?: string
          numero?: string
          numero_nf?: string | null
          observacoes?: string | null
          outros?: number
          owner_id?: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["compra_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_empresa: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          logo_url: string | null
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          owner_id: string
          razao_social: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          owner_id: string
          razao_social: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          owner_id?: string
          razao_social?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      estoque_movimentacoes: {
        Row: {
          compra_id: string | null
          created_at: string
          custo_unitario: number | null
          data_movimentacao: string
          id: string
          lote_id: string | null
          observacoes: string | null
          origem: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id: string
          produto_id: string
          quantidade: number
          saldo_anterior: number | null
          saldo_posterior: number | null
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id: string | null
          venda_id: string | null
        }
        Insert: {
          compra_id?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_movimentacao?: string
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id: string
          produto_id: string
          quantidade: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id?: string | null
          venda_id?: string | null
        }
        Update: {
          compra_id?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_movimentacao?: string
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id?: string
          produto_id?: string
          quantidade?: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id?: string | null
          venda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_movs_compra"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_movs_venda"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_lancamentos: {
        Row: {
          categoria_id: string | null
          cliente_id: string | null
          compra_id: string | null
          created_at: string
          data_emissao: string
          data_pagamento: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor_id: string | null
          id: string
          numero_documento: string | null
          observacoes: string | null
          owner_id: string
          parcela_numero: number | null
          parcela_total: number | null
          status: Database["public"]["Enums"]["lancamento_status"]
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at: string
          valor: number
          valor_pago: number
          venda_id: string | null
        }
        Insert: {
          categoria_id?: string | null
          cliente_id?: string | null
          compra_id?: string | null
          created_at?: string
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          observacoes?: string | null
          owner_id: string
          parcela_numero?: number | null
          parcela_total?: number | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor: number
          valor_pago?: number
          venda_id?: string | null
        }
        Update: {
          categoria_id?: string | null
          cliente_id?: string | null
          compra_id?: string | null
          created_at?: string
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento?: string
          descricao?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          observacoes?: string | null
          owner_id?: string
          parcela_numero?: number | null
          parcela_total?: number | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          tipo?: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor?: number
          valor_pago?: number
          venda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_lancamentos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_financeiras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          contato_nome: string | null
          created_at: string
          documento: string | null
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          owner_id: string
          razao_social: string
          status: Database["public"]["Enums"]["cadastro_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          contato_nome?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id: string
          razao_social: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          contato_nome?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id?: string
          razao_social?: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      lotes_produto: {
        Row: {
          created_at: string
          custo_unitario: number | null
          data_fabricacao: string | null
          data_validade: string | null
          id: string
          numero_lote: string
          observacoes: string | null
          owner_id: string
          produto_id: string
          quantidade_atual: number
          quantidade_inicial: number
          updated_at: string
          variacao_id: string | null
        }
        Insert: {
          created_at?: string
          custo_unitario?: number | null
          data_fabricacao?: string | null
          data_validade?: string | null
          id?: string
          numero_lote: string
          observacoes?: string | null
          owner_id: string
          produto_id: string
          quantidade_atual?: number
          quantidade_inicial?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Update: {
          created_at?: string
          custo_unitario?: number | null
          data_fabricacao?: string | null
          data_validade?: string | null
          id?: string
          numero_lote?: string
          observacoes?: string | null
          owner_id?: string
          produto_id?: string
          quantidade_atual?: number
          quantidade_inicial?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_produto_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_produto_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      produto_variacoes: {
        Row: {
          ativo: boolean
          atributos: Json
          codigo_barras: string | null
          created_at: string
          id: string
          nome: string
          owner_id: string
          preco_custo: number | null
          preco_venda: number | null
          produto_id: string
          sku: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          atributos?: Json
          codigo_barras?: string | null
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          preco_custo?: number | null
          preco_venda?: number | null
          produto_id: string
          sku: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          atributos?: Json
          codigo_barras?: string | null
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          preco_custo?: number | null
          preco_venda?: number | null
          produto_id?: string
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_variacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          categoria_id: string | null
          cest: string | null
          codigo_barras: string | null
          created_at: string
          descricao: string | null
          estoque_inicial: number
          estoque_minimo: number
          id: string
          imagem_url: string | null
          marca: string | null
          ncm: string | null
          nome: string
          origem: string | null
          owner_id: string
          preco_custo: number
          preco_venda: number
          sku: string
          status: Database["public"]["Enums"]["produto_status"]
          unidade: string
          updated_at: string
        }
        Insert: {
          categoria_id?: string | null
          cest?: string | null
          codigo_barras?: string | null
          created_at?: string
          descricao?: string | null
          estoque_inicial?: number
          estoque_minimo?: number
          id?: string
          imagem_url?: string | null
          marca?: string | null
          ncm?: string | null
          nome: string
          origem?: string | null
          owner_id: string
          preco_custo?: number
          preco_venda?: number
          sku: string
          status?: Database["public"]["Enums"]["produto_status"]
          unidade?: string
          updated_at?: string
        }
        Update: {
          categoria_id?: string | null
          cest?: string | null
          codigo_barras?: string | null
          created_at?: string
          descricao?: string | null
          estoque_inicial?: number
          estoque_minimo?: number
          id?: string
          imagem_url?: string | null
          marca?: string | null
          ncm?: string | null
          nome?: string
          origem?: string | null
          owner_id?: string
          preco_custo?: number
          preco_venda?: number
          sku?: string
          status?: Database["public"]["Enums"]["produto_status"]
          unidade?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venda_itens: {
        Row: {
          created_at: string
          desconto: number
          descricao: string | null
          id: string
          lote_id: string | null
          owner_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          total: number
          updated_at: string
          variacao_id: string | null
          venda_id: string
        }
        Insert: {
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id: string
          preco_unitario?: number
          produto_id: string
          quantidade: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
          venda_id: string
        }
        Update: {
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
          venda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "venda_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      vendas: {
        Row: {
          cliente_id: string | null
          created_at: string
          data_emissao: string
          data_entrega: string | null
          desconto: number
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          frete: number
          id: string
          numero: string
          numero_nf: string | null
          observacoes: string | null
          outros: number
          owner_id: string
          serie_nf: string | null
          status: Database["public"]["Enums"]["venda_status"]
          subtotal: number
          total: number
          updated_at: string
          vendedor_id: string | null
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega?: string | null
          desconto?: number
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frete?: number
          id?: string
          numero: string
          numero_nf?: string | null
          observacoes?: string | null
          outros?: number
          owner_id: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["venda_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega?: string | null
          desconto?: number
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frete?: number
          id?: string
          numero?: string
          numero_nf?: string | null
          observacoes?: string | null
          outros?: number
          owner_id?: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["venda_status"]
          subtotal?: number
          total?: number
          updated_at?: string
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_user: { Args: { _user_id: string }; Returns: undefined }
      admin_estatisticas_globais: { Args: never; Returns: Json }
      admin_listar_audit_logs: {
        Args: { _limit?: number }
        Returns: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_listar_usuarios: {
        Args: never
        Returns: {
          created_at: string
          email: string
          email_confirmed: boolean
          last_sign_in_at: string
          roles: string[]
          total_compras: number
          total_produtos: number
          total_vendas: number
          user_id: string
        }[]
      }
      admin_set_user_role: {
        Args: {
          _grant?: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      calcular_saldo_estoque: {
        Args: { _produto_id: string; _variacao_id?: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      receber_compra: {
        Args: {
          _categoria_id?: string
          _compra_id: string
          _data_recebimento?: string
          _data_vencimento?: string
          _gerar_financeiro?: boolean
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "admin" | "gerente" | "vendedor" | "financeiro" | "super_admin"
      cadastro_status: "ativo" | "inativo"
      categoria_financeira_tipo: "receita" | "despesa"
      compra_status:
        | "rascunho"
        | "pendente"
        | "aprovada"
        | "recebida"
        | "cancelada"
      forma_pagamento:
        | "dinheiro"
        | "pix"
        | "cartao_credito"
        | "cartao_debito"
        | "boleto"
        | "transferencia"
        | "cheque"
        | "outro"
      lancamento_status:
        | "pendente"
        | "pago"
        | "recebido"
        | "vencido"
        | "cancelado"
      lancamento_tipo: "receita" | "despesa"
      movimentacao_origem:
        | "compra"
        | "venda"
        | "ajuste_manual"
        | "devolucao_cliente"
        | "devolucao_fornecedor"
        | "inventario"
        | "outro"
      movimentacao_tipo:
        | "entrada"
        | "saida"
        | "ajuste"
        | "devolucao"
        | "transferencia"
      pessoa_tipo: "PF" | "PJ"
      produto_status: "ativo" | "inativo" | "descontinuado"
      venda_status:
        | "rascunho"
        | "pendente"
        | "aprovada"
        | "faturada"
        | "entregue"
        | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "gerente", "vendedor", "financeiro", "super_admin"],
      cadastro_status: ["ativo", "inativo"],
      categoria_financeira_tipo: ["receita", "despesa"],
      compra_status: [
        "rascunho",
        "pendente",
        "aprovada",
        "recebida",
        "cancelada",
      ],
      forma_pagamento: [
        "dinheiro",
        "pix",
        "cartao_credito",
        "cartao_debito",
        "boleto",
        "transferencia",
        "cheque",
        "outro",
      ],
      lancamento_status: [
        "pendente",
        "pago",
        "recebido",
        "vencido",
        "cancelado",
      ],
      lancamento_tipo: ["receita", "despesa"],
      movimentacao_origem: [
        "compra",
        "venda",
        "ajuste_manual",
        "devolucao_cliente",
        "devolucao_fornecedor",
        "inventario",
        "outro",
      ],
      movimentacao_tipo: [
        "entrada",
        "saida",
        "ajuste",
        "devolucao",
        "transferencia",
      ],
      pessoa_tipo: ["PF", "PJ"],
      produto_status: ["ativo", "inativo", "descontinuado"],
      venda_status: [
        "rascunho",
        "pendente",
        "aprovada",
        "faturada",
        "entregue",
        "cancelada",
      ],
    },
  },
} as const

-- A reconciliação de extratos grandes é uma operação contabilística protegida.
-- O limite normal da API não deve cancelar a função a meio do cálculo.
alter function private.finalize_rt_v2_import(uuid) set statement_timeout='0';
alter function public.finalize_rt_v2_import(uuid) set statement_timeout='0';

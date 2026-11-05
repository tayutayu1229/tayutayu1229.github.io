import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.119.0';
import '../assets/js/managed-db-client.js?v=20261106-loading2';
// Query builder only; all data and authorization are served by Ubuntu/Firebase.
export const supabase=window.TayunetManagedDb.client(createClient,'operations');

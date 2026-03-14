// supabaseClient.js
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseUrl = "https://ocbfofvfetjwulnjqzjz.supabase.co";
const supabaseKey = "sb_publishable_knzVSTXmXH1jtGEjjG7zDQ_e7LYd9Zk";

export const supabase = createClient(supabaseUrl, supabaseKey);

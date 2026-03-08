const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');
const webpush = require('web-push');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

webpush.setVapidDetails(
  'mailto:test@example.com', // Replace with your email if you want, but test@example is fine
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

const handler = async (event) => {
  try {
    const now = new Date().toISOString();

    // 1. Find everyone whose reminder time is in the past
    const { data: dueReminders, error: fetchError } = await supabase
      .from('subscriptions')
      .select('*')
      .lte('next_reminder_at', now);

    if (fetchError) throw fetchError;
    if (!dueReminders || dueReminders.length === 0) return { statusCode: 200 };

    const updates = [];
    const deletes = [];

    // 2. Send the push notification to each user
    for (const sub of dueReminders) {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: { auth: sub.auth_key, p256dh: sub.p256dh_key }
      };

      try {
        const payload = JSON.stringify({ title: '💧 SipH2O', body: 'Time to drink some water!' });
        await webpush.sendNotification(pushSubscription, payload);

        // Calculate their NEXT reminder time
        const nextTime = new Date(Date.now() + sub.interval_min * 60000).toISOString();
        updates.push({ id: sub.id, next_reminder_at: nextTime });

      } catch (pushErr) {
        // If the browser unsubscribed or blocked us, queue it for deletion
        if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
          deletes.push(sub.id);
        }
      }
    }

    // 3. Update the database with the new reminder times
    for (const update of updates) {
      await supabase.from('subscriptions').update({ next_reminder_at: update.next_reminder_at }).eq('id', update.id);
    }

    // 4. Delete old/broken subscriptions
    if (deletes.length > 0) {
      await supabase.from('subscriptions').delete().in('id', deletes);
    }

    return { statusCode: 200 };
  } catch (err) {
    console.error(err);
    return { statusCode: 500 };
  }
};

// This tells Netlify to run this exact function every single minute (* * * * *)
exports.handler = schedule('* * * * *', handler);
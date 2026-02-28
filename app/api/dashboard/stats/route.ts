export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
    try {
        const user = await requireAuth(request);
        const supabase = createSupabaseServerClient();

        console.log(`[DASHBOARD STATS] Verified User ID: ${user.id}`);

        // 1. Fetch connected accounts
        const { data: accounts, error: accountsError } = await supabase
            .from('connected_accounts')
            .select('platform, id')
            .eq('user_id', user.id)
            .neq('access_token', '');

        if (accountsError) throw accountsError;

        console.log(`[DASHBOARD STATS] Found ${accounts?.length || 0} active connections for user.`);

        const hasAccounts = accounts && accounts.length > 0;
        const connectedPlatforms = Array.from(new Set((accounts || []).map(a => a.platform)));

        // 2. Fetch all posts for the user
        let posts: any[] = [];
        const { data: postsData, error: postsError } = await supabase
            .from('posts')
            .select('*')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });

        if (postsError) {
            if (postsError.code === '42P01') {
                console.warn("[DASHBOARD STATS] 'posts' table not found yet (PGRST205/42P01). Assuming 0 posts.");
            } else {
                throw postsError;
            }
        } else if (postsData) {
            posts = postsData;
        }

        const totalPosts = posts.length;
        const recentPosts = posts.slice(0, 5);

        // 3. Fetch analytics for the user's posts
        // Determine post IDs to filter
        const postIds = posts ? posts.map(p => p.id) : [];

        let analytics = [];
        if (postIds.length > 0) {
            const { data: analyticsData, error: analyticsError } = await supabase
                .from('post_analytics')
                .select('*')
                .in('post_id', postIds);

            if (analyticsError) {
                if (analyticsError.code === '42P01') {
                    console.warn("[DASHBOARD STATS] 'post_analytics' table not found yet (PGRST205/42P01). Assuming 0 analytics.");
                } else {
                    console.error("Analytics Error:", analyticsError);
                }
            } else if (analyticsData) {
                analytics = analyticsData;
            }
        }

        // 4. Calculate core metrics
        let totalReach = 0;
        let totalImpressions = 0;
        let totalEngagement = 0;

        // Platform breakdown
        const platformStats: Record<string, { posts: number; reach: number; impressions: number; engagement: number; likes: number; comments: number; shares: number }> = {};

        // Initialize connected platforms
        connectedPlatforms.forEach(p => {
            platformStats[p] = { posts: 0, reach: 0, impressions: 0, engagement: 0, likes: 0, comments: 0, shares: 0 };
        });

        // Group posts by platform
        posts?.forEach(post => {
            const p = post.platform || 'General';
            if (!platformStats[p]) {
                platformStats[p] = { posts: 0, reach: 0, impressions: 0, engagement: 0, likes: 0, comments: 0, shares: 0 };
            }
            platformStats[p].posts += 1;
        });

        analytics.forEach((a: any) => {
            const p = a.platform || 'General';

            totalReach += Number(a.reach || 0);
            totalImpressions += Number(a.impressions || 0);

            const likes = Number(a.likes || 0);
            const comments = Number(a.comments || 0);
            const shares = Number(a.shares || 0);
            const engagements = likes + comments + shares;

            totalEngagement += engagements;

            if (platformStats[p]) {
                platformStats[p].reach += Number(a.reach || 0);
                platformStats[p].impressions += Number(a.impressions || 0);
                platformStats[p].likes += likes;
                platformStats[p].comments += comments;
                platformStats[p].shares += shares;
                platformStats[p].engagement += engagements;
            }
        });

        const engagementRate = totalImpressions > 0
            ? ((totalEngagement / totalImpressions) * 100).toFixed(1)
            : 0;

        return NextResponse.json({
            success: true,
            hasAccounts,
            connectedPlatforms,
            metrics: {
                totalPosts,
                totalReach,
                totalImpressions,
                totalEngagement,
                engagementRate: Number(engagementRate)
            },
            platformStats,
            recentPosts,
            lastUpdated: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Dashboard Stats API Error:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        return NextResponse.json(
            { error: error.message || 'Failed to fetch dashboard stats' },
            { status: 500 }
        );
    }
}

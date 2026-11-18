import { internalQuery } from "./_generated/server";

export const findWormey = internalQuery({
  args: {},
  handler: async (ctx) => {
    const kingdoms = await ctx.db.query("kingdoms").collect();
    const users = await ctx.db.query("users" as any).collect();
    const territories = await ctx.db.query("territories").collect();

    const wormeyKingdoms = kingdoms.filter(k => 
      k.name.toLowerCase().includes("wormey") || 
      k.userId.toLowerCase().includes("wormey")
    );

    const wormeyUsers = users.filter((u: any) => 
      (u.name && u.name.toLowerCase().includes("wormey")) || 
      (u.email && u.email.toLowerCase().includes("wormey"))
    );

    return {
      wormeyKingdoms,
      wormeyUsers,
      totalKingdomsCount: kingdoms.length,
      allKingdomNames: kingdoms.map(k => ({ id: k._id, name: k.name, userId: k.userId })),
    };
  },
});

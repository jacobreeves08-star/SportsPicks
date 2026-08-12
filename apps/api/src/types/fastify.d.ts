import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the `authenticate` preHandler (see plugins/authenticate.ts).
     * Null until that preHandler runs and succeeds. */
    user: { id: string; sessionId: string } | null;
  }
}

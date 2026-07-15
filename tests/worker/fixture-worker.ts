export default {
	fetch() {
		return new Response('worker test fixture');
	},
} satisfies ExportedHandler<Cloudflare.Env>;

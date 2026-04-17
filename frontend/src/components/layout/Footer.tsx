import { FaEnvelope, FaGithub } from "react-icons/fa";
import {
	APP_DESCRIPTION,
	APP_NAME,
	CONTRIBUTORS,
	DATASET_NAME,
	DATASET_URL,
	GITHUB_URL,
	TEAM_NAME,
} from "@/constants/app";

export default function Footer() {
	return (
		<footer className="bg-card text-card-foreground border-t border-border mt-12">
			<div className="max-w-6xl mx-auto px-6 py-6 flex flex-col gap-3">
				{/* Cards Grid */}
				<div className="grid md:grid-cols-3 gap-3">
					{/* About Card */}
					<div className="p-3 rounded-lg bg-background/50 hover:bg-background transition">
						<h3 className="text-lg font-semibold mb-2">{APP_NAME}</h3>
						<p className="text-muted-foreground leading-relaxed text-sm">
							{APP_DESCRIPTION}
						</p>
					</div>

					{/* Course Info Card */}
					<div className="p-3 rounded-lg bg-background/50 hover:bg-background transition">
						<h4 className="font-semibold mb-2 text-sm">Course Information</h4>
						<p className="text-muted-foreground leading-relaxed text-sm">
							This project was developed for CS 4485 Computer Science Project at{" "}
							<a
								target="_blank"
								rel="noopener noreferrer"
								className="hover:text-primary transition"
								href={"https://utdallas.edu"}
							>
								The University of Texas at Dallas
							</a>
							.
						</p>
					</div>

					{/* Data Card */}
					<div className="p-3 rounded-lg bg-background/50 hover:bg-background transition">
						<h4 className="font-semibold mb-2 text-sm">Data</h4>
						<p className="text-muted-foreground leading-relaxed text-sm">
							Imagery sourced from the{" "}
							<a
								href={DATASET_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline transition"
							>
								{DATASET_NAME}
							</a>
							. Georeferenced in WGS84 (EPSG:4326).
						</p>
					</div>
				</div>

				{/* Contributors Card */}
				<div className="p-3 rounded-lg bg-background/50">
					<h4 className="font-semibold mb-2 text-sm">Contributors</h4>

					<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
						{CONTRIBUTORS.map((person) => (
							<div
								key={person.name}
								className="p-2 rounded-md bg-background hover:bg-foreground/5 transition flex flex-col gap-1"
							>
								{/* Name */}
								<div className="text-sm">
									<div className="font-medium text-foreground">
										{person.name}
									</div>
									<div className="text-xs text-muted-foreground">
										{person.role}
									</div>
								</div>

								{/* Icons */}
								<div className="flex items-center gap-2">
									<a
										href={`mailto:${person.email}`}
										className="text-muted-foreground hover:text-primary transition"
										title="Send Email"
									>
										<FaEnvelope className="text-xs" />
									</a>

									<a
										href={person.github}
										target="_blank"
										rel="noopener noreferrer"
										className="text-muted-foreground hover:text-primary transition"
										title="GitHub Profile"
									>
										<FaGithub className="text-xs" />
									</a>
								</div>
							</div>
						))}
					</div>
				</div>

				{/* Bottom Card */}
				<div className="p-3 rounded-lg bg-background/50 text-center">
					<div className="flex items-center justify-center gap-2 text-xs text-muted-foreground mb-2">
						<span>
							© {new Date().getFullYear()} {TEAM_NAME}
						</span>
					</div>
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 text-xs text-foreground hover:text-primary transition font-medium"
					>
						<FaGithub />
						<span>View on GitHub</span>
					</a>
				</div>
			</div>
		</footer>
	);
}

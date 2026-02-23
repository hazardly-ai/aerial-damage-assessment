import React from "react";
import { FaEnvelope, FaGithub } from "react-icons/fa";
import {
	APP_NAME,
	TEAM_NAME,
	DATASET_NAME,
	DATASET_URL,
	GITHUB_URL,
	APP_DESCRIPTION,
	CONTRIBUTORS,
} from "@/constants/app";

export default function Footer() {
	return (
		<footer className="bg-card text-card-foreground border-t border-border mt-12">
			<div className="max-w-6xl mx-auto px-6 py-8 flex flex-col gap-8">
				{/* Top Grid */}
				<div className="grid md:grid-cols-3 gap-8">
					{/* About */}
					<div>
						<h3 className="text-lg font-semibold mb-3">{APP_NAME}</h3>
						<p className="text-muted-foreground leading-relaxed">
							{APP_DESCRIPTION}
						</p>
					</div>

					{/* Course Info */}
					<div>
						<h4 className="font-semibold mb-3">Course Information</h4>
						<p className="text-muted-foreground leading-relaxed">
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

					{/* Contributors */}
					<div>
						<h4 className="font-semibold mb-3">Contributors</h4>

						<ul className="space-y-3 text-muted-foreground">
							{CONTRIBUTORS.map((person, index) => (
								<li key={index} className="flex items-center justify-between">
									{/* Name + Role */}
									<div className="text-sm">
										<span className="font-medium text-foreground">
											{person.name}
										</span>
										<span className="text-muted-foreground ml-2">
											— {person.role}
										</span>
									</div>

									{/* Icons */}
									<div className="flex items-center gap-3">
										<a
											href={`mailto:${person.email}`}
											className="hover:text-primary transition"
											title="Send Email"
										>
											<FaEnvelope />
										</a>

										<a
											href={person.github}
											target="_blank"
											rel="noopener noreferrer"
											className="hover:text-primary transition"
											title="GitHub Profile"
										>
											<FaGithub />
										</a>
									</div>
								</li>
							))}
						</ul>
					</div>
				</div>

				{/* Data Section */}
				<div>
					<h4 className="font-semibold mb-3">Data</h4>
					<p className="text-muted-foreground leading-relaxed">
						Imagery sourced from the{" "}
						<a
							href={DATASET_URL}
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline"
						>
							{DATASET_NAME}
						</a>
						. Georeferenced in WGS84 (EPSG:4326).
					</p>
				</div>

				{/* Bottom */}
				<div className="border-t border-border pt-6 text-center text-sm text-muted-foreground">
					<a
						href={GITHUB_URL}
						target="_blank"
						rel="noopener noreferrer"
						className="hover:text-primary transition"
					>
						© {new Date().getFullYear()} {TEAM_NAME}
					</a>
				</div>
			</div>
		</footer>
	);
}

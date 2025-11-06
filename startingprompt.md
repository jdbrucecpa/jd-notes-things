i want to create my own custom AI Meeting Notetaker. I want to use Recall.ai Desktop Recording SDK. It will be called JD Notes Things. My company brand is JD Knows Things

It needs a Windows application that can record meetings from Zoom, Microsoft Teams, and Google Meet, and also transcribe any system audio that I manually start recording. 

Documentation:
https://docs.recall.ai/docs/getting-started
https://github.com/recallai/muesli-public
https://github.com/recallai

Here is my desired workflow.
1. The app can see my calendar and starts recording when a meeting starts. It should support Zoom, Microsoft Teams, and Google Meet or should offer to start recording when a meeting with participants is scheduled on my calendar or when a meeting on one of those apps becomes active. I should also be able to just hit record to transcribe personal voice notes.
2. The app should transcribe the audio with speaker recognition to differentiate between speakers. Real time is good but not required.
3. After the meeting, the transcript should be saved as an MD file with timestamps and speaker labels, with automatic routing if the email address matches a known contact. This can operate on a white list basis so that my client notes get saved into the proper folders, but unknown contacts can go into a general folder for manual sorting.
The transcript should also be summarized into various types of meeting summaries based on templates that we need to develop. these would be saved in a subfolder of the client folder, one subfolder for each different meeting. For example, a client meeting summary might have different sections than an internal team meeting summary
The files should then be indexed into an overall summary for each meeting designed to allow an LLM to look through and find relevant information later.
4. The app should have a simple UI to allow me to set up client contact mapping, meeting summary templates, and general settings like audio quality, transcription preferences, and storage locations.
5. The app should have a notification system to alert me when recording starts, stops, and when transcripts and summaries are ready.
6. The app should ensure data privacy and security, with options for local storage only, encryption of transcripts, and compliance with relevant data protection regulations.

I want the app to integrate into google calendar, and to my google contacts for contact mapping.
I would also like it to integrate into Hubspot to save the overall meeting summary and a link to Obsidian notes for each meeting automatically.

I would also like it to be able to import prior transcripts and execute the summaries and indexing on those as well.

There is an open source project called Meetily that has executed on some of these features, but not all, and I've decided that recall.ai's SDK is a better fit for my needs. But, as we are developing, we can use that project as a reference for certain features.

I want to create a specification document for you to build this application in short distinct phases, with clearly defined deliverables for each phase. Each phase should build upon the previous one, gradually adding more features and complexity until the final product is complete.

Ask as many questions as you need to clarify the requirements before proceeding with the specification document.
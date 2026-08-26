codeunit 70902 "CG X130 Outreach Tracker"
{
    var
        TrackedIds: List of [Code[20]];

    procedure Attach(QueuedIds: List of [Code[20]])
    begin
        TrackedIds := QueuedIds;
    end;

    procedure AwaitingOutreach(): List of [Code[20]]
    begin
        exit(TrackedIds);
    end;
}

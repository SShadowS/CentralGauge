codeunit 70731 "CG X113 Dispatch Check"
{
    procedure HasPendingJobs(DispatcherCode: Code[20]): Boolean
    var
        DispatchEntry: Record "CG X113 Dispatch Entry";
    begin
        DispatchEntry.SetRange("Dispatcher Code", DispatcherCode);
        DispatchEntry.SetRange(Pending, true);
        exit(not DispatchEntry.IsEmpty());
    end;

    procedure IsUnassigned(DispatcherCode: Code[20]): Boolean
    var
        DispatchEntry: Record "CG X113 Dispatch Entry";
        EntryCount: Integer;
    begin
        DispatchEntry.SetRange("Dispatcher Code", DispatcherCode);
        if DispatchEntry.FindSet() then
            repeat
                EntryCount += 1;
            until DispatchEntry.Next() = 0;
        exit(EntryCount = 0);
    end;

    procedure PendingJobCount(DispatcherCode: Code[20]): Integer
    var
        DispatchEntry: Record "CG X113 Dispatch Entry";
    begin
        DispatchEntry.SetRange("Dispatcher Code", DispatcherCode);
        DispatchEntry.SetRange(Pending, true);
        exit(DispatchEntry.Count());
    end;
}

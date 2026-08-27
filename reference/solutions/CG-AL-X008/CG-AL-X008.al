codeunit 70970 "CG X008 Orchestrator"
{
    Access = Internal;

    procedure ComputeViaWorker(Inputs: List of [Integer]): Integer
    var
        InputRec: Record "CG X008 Input";
        SignalRec: Record "CG X008 Signal";
        Value: Integer;
        EntryNo: Integer;
        SessionId: Integer;
        MaxWaitMs: Integer;
        WaitedMs: Integer;
        PollIntervalMs: Integer;
    begin
        // Reset input and signal state
        InputRec.DeleteAll();

        EntryNo := 0;
        foreach Value in Inputs do begin
            EntryNo += 1;
            InputRec.Init();
            InputRec."Entry No." := EntryNo;
            InputRec."Value" := Value;
            InputRec.Insert();
        end;

        if not SignalRec.Get('') then begin
            SignalRec.Init();
            SignalRec."Primary Key" := '';
            SignalRec.Insert();
        end;
        SignalRec."Done" := false;
        SignalRec."Result" := 0;
        SignalRec.Modify();

        Commit();

        // Start worker in a background session
        StartSession(SessionId, Codeunit::"CG X008 Worker");

        // Bounded wait for completion
        MaxWaitMs := 30000;
        PollIntervalMs := 100;
        WaitedMs := 0;

        repeat
            Sleep(PollIntervalMs);
            WaitedMs += PollIntervalMs;
            SignalRec.ReadIsolation := IsolationLevel::ReadCommitted;
            if SignalRec.Get('') then
                if SignalRec."Done" then
                    exit(SignalRec."Result");
        until WaitedMs >= MaxWaitMs;

        Error('Timed out waiting for background worker to complete.');
    end;
}
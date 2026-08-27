codeunit 70208 "CG Session Counter"
{
    SingleInstance = true;
    Access = Public;

    var
        CallCount: Integer;
        LastCalledAt: DateTime;
        SessionStarted: DateTime;

    procedure Initialize()
    begin
        if SessionStarted = 0DT then
            SessionStarted := CurrentDateTime();
    end;

    procedure IncrementAndGet(): Integer
    begin
        CallCount += 1;
        LastCalledAt := CurrentDateTime();
        exit(CallCount);
    end;

    procedure GetCallCount(): Integer
    begin
        exit(CallCount);
    end;

    procedure GetSessionDuration(): Duration
    begin
        if SessionStarted = 0DT then
            exit(0);

        exit(CurrentDateTime() - SessionStarted);
    end;

    procedure Reset()
    begin
        CallCount := 0;
        LastCalledAt := 0DT;
    end;
}
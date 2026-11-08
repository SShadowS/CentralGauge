codeunit 70268 "CGR Desk Attempts"
{
    SingleInstance = true;

    var
        FailureCount: Integer;

    procedure Failures(): Integer
    begin
        exit(FailureCount);
    end;

    procedure AddFailure()
    begin
        FailureCount += 1;
    end;

    procedure Reset()
    begin
        FailureCount := 0;
    end;
}

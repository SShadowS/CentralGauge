codeunit 86201 "HX037 Check Extension"
{
    EventSubscriberInstance = Manual;

    var
        ProblemTexts: List of [Text];
        StopText: Text;

    procedure AddProblem(ProblemText: Text)
    begin
        ProblemTexts.Add(ProblemText);
    end;

    procedure SetStop(NewStopText: Text)
    begin
        StopText := NewStopText;
    end;

    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Contract Check", 'OnCheckContractForPosting', '', false, false)]
    local procedure OnCheckContractForPosting(RentalContract: Record "CGR Rental Contract")
    var
        ProblemText: Text;
        Problem: ErrorInfo;
    begin
        foreach ProblemText in ProblemTexts do begin
            Problem := ErrorInfo.Create(ProblemText, true);
            Error(Problem);
        end;
        if StopText <> '' then
            Error('%1', StopText);
    end;
}

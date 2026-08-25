codeunit 70722 "CG X112 Summary Builder"
{
    procedure BuildSummaries(var Agreement: Record "CG X112 Job Agreement"; AsOfDate: Date): Dictionary of [Code[20], Text[250]]
    var
        StatusEntry: Record "CG X112 Status Entry";
        Summaries: Dictionary of [Code[20], Text[250]];
        BatchAgreementNos: Dictionary of [Code[20], Boolean];
        SummaryText: Text[250];
    begin
        if Agreement.FindSet() then
            repeat
                BatchAgreementNos.Set(Agreement."No.", true);
            until Agreement.Next() = 0;

        StatusEntry.SetRange(Resolved, false);
        StatusEntry.SetFilter("Entry Date", '<=%1', AsOfDate);
        if StatusEntry.FindSet() then
            repeat
                if BatchAgreementNos.ContainsKey(StatusEntry."Agreement No.") then begin
                    SummaryText := StrSubstNo('%1: %2', Format(StatusEntry.Severity), StatusEntry.Message);
                    Summaries.Set(StatusEntry."Agreement No.", SummaryText);
                end;
            until StatusEntry.Next() = 0;

        if Agreement.FindSet() then
            repeat
                if not Summaries.ContainsKey(Agreement."No.") then
                    Summaries.Set(Agreement."No.", 'No open issues');
            until Agreement.Next() = 0;

        exit(Summaries);
    end;
}

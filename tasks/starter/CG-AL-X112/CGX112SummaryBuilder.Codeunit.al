codeunit 70722 "CG X112 Summary Builder"
{
    procedure BuildSummaries(var Agreement: Record "CG X112 Job Agreement"; AsOfDate: Date): Dictionary of [Code[20], Text[250]]
    var
        StatusEntry: Record "CG X112 Status Entry";
        Summaries: Dictionary of [Code[20], Text[250]];
        SummaryText: Text[250];
    begin
        if Agreement.FindSet() then
            repeat
                StatusEntry.Reset();
                StatusEntry.SetRange("Agreement No.", Agreement."No.");
                StatusEntry.SetRange(Resolved, false);
                StatusEntry.SetFilter("Entry Date", '<=%1', AsOfDate);
                if StatusEntry.FindLast() then
                    SummaryText := StrSubstNo('%1: %2', Format(StatusEntry.Severity), StatusEntry.Message)
                else
                    SummaryText := 'No open issues';
                Summaries.Set(Agreement."No.", SummaryText);
            until Agreement.Next() = 0;

        exit(Summaries);
    end;
}

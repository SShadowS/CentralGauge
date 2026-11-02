codeunit 87384 "HX096 Suggest Runner"
{
    trigger OnRun()
    var
        PayoutSuggestion: Codeunit "CGR Payout Suggestion";
    begin
        PayoutSuggestion.SuggestPayouts(DMY2Date(31, 5, 2027));
    end;
}

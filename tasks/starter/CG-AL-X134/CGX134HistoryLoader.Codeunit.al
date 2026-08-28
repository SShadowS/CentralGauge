codeunit 70944 "CG X134 History Loader"
{
    /// Fills Buffer with the approver's 20 most recent history entries,
    /// each row carrying its request's Description and Paid Amount
    /// alongside it.
    procedure LoadRecentHistory(Approver: Code[50]; var Buffer: Record "CG X134 History Buffer" temporary)
    var
        HistoryEntry: Record "CG X134 History Entry";
        Request: Record "CG X134 Request";
    begin
        Buffer.Reset();
        Buffer.DeleteAll();

        HistoryEntry.SetRange(Approver, Approver);
        if HistoryEntry.FindSet() then
            repeat
                Request.Get(HistoryEntry."Request No.");
                Request.CalcFields("Paid Amount");

                Buffer.Init();
                Buffer."Entry No." := HistoryEntry."Entry No.";
                Buffer."Request No." := HistoryEntry."Request No.";
                Buffer.Description := Request.Description;
                Buffer."Paid Amount" := Request."Paid Amount";
                Buffer.Insert();
            until HistoryEntry.Next() = 0;
    end;
}

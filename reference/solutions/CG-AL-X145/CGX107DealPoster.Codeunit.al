codeunit 70672 "CG X107 Deal Poster"
{
    procedure PostDeal(SourceNo: Code[20])
    var
        DealHeader: Record "CG X107 Deal Header";
        PostedDeal: Record "CG X107 Posted Deal";
    begin
        DealHeader.Get(SourceNo);

        PostedDeal.Init();
        PostedDeal."No." := DealHeader."No.";
        PostedDeal.Amount := DealHeader.Amount;

        OnBeforePostedDealInsert(PostedDeal, DealHeader);
        PostedDeal.Insert(true);
        OnAfterPostedDealInsert(PostedDeal, DealHeader);
    end;

    [IntegrationEvent(false, false)]
    local procedure OnBeforePostedDealInsert(var PostedDeal: Record "CG X107 Posted Deal"; DealHeader: Record "CG X107 Deal Header")
    begin
    end;

    [IntegrationEvent(false, false)]
    local procedure OnAfterPostedDealInsert(var PostedDeal: Record "CG X107 Posted Deal"; DealHeader: Record "CG X107 Deal Header")
    begin
    end;
}

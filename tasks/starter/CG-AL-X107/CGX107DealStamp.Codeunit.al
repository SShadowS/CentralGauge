codeunit 70673 "CG X107 Deal Stamp"
{
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CG X107 Deal Poster", 'OnAfterPostedDealInsert', '', false, false)]
    local procedure StampDealReference(var PostedDeal: Record "CG X107 Posted Deal"; DealHeader: Record "CG X107 Deal Header")
    begin
        PostedDeal."Deal Reference" := DealHeader."Deal Reference";
    end;
}

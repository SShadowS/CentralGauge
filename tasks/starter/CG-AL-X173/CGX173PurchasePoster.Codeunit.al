codeunit 71574 "CG X173 Purchase Poster"
{
    procedure PostPurchaseRun(var PostingLine: Record "CG X173 Posting Line" temporary; var PostedPurchase: Record "CG X173 Posted Purchase" temporary)
    var
        Requisition: Record "CG X156 Requisition";
        Vendor: Record "CG X173 Vendor";
        Terms: Record "CG X173 Payment Terms";
        BlockList: Codeunit "CG X151 Block List";
        Fulfillment: Codeunit "CG X158 Fulfillment";
        OrderLine: Record "CG X158 Order Line";
        DiscountPct: Decimal;
    begin
        PostedPurchase.Reset();
        PostedPurchase.DeleteAll();

        if PostingLine.FindSet() then
            repeat
                Requisition.SetRange("No.", PostingLine."Requisition No.");
                if Requisition.FindFirst() then
                    if Requisition.Status = Requisition.Status::Released then
                        if not (BlockList.IsBlocked(PostingLine."Vendor No.") or BlockList.IsBlocked(PostingLine."Item No.")) then begin
                            Clear(OrderLine);
                            OrderLine."Item No." := PostingLine."Item No.";
                            OrderLine.Quantity := Requisition.Quantity;
                            if Fulfillment.CanFulfill(OrderLine) then
                                if Vendor.Get(PostingLine."Vendor No.") then begin
                                    DiscountPct := 0;
                                    if Terms.Get(Vendor."Terms Code") then
                                        DiscountPct := Terms."Discount Pct";

                                    PostedPurchase.Init();
                                    PostedPurchase."Requisition No." := Requisition."No.";
                                    PostedPurchase."Vendor No." := Vendor."No.";
                                    PostedPurchase."Vendor Name" := Vendor.Name;
                                    PostedPurchase.Quantity := Requisition.Quantity;
                                    PostedPurchase."Unit Cost" := PostingLine."Unit Cost";
                                    PostedPurchase."Discount Pct" := DiscountPct;
                                    PostedPurchase."Net Amount" := Requisition.Quantity * PostingLine."Unit Cost" * (1 - DiscountPct / 100);
                                    PostedPurchase.Insert();
                                end;
                        end;
            until PostingLine.Next() = 0;
    end;
}

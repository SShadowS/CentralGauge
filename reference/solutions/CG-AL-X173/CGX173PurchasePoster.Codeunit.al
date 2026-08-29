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
        RequisitionQty: Dictionary of [Code[20], Decimal];
        RequisitionReleased: Dictionary of [Code[20], Boolean];
        VendorName: Dictionary of [Code[20], Text[100]];
        VendorTermsCode: Dictionary of [Code[20], Code[10]];
        TermsDiscount: Dictionary of [Code[10], Decimal];
        TermsCode: Code[10];
        DiscountPct: Decimal;
    begin
        PostedPurchase.Reset();
        PostedPurchase.DeleteAll();

        if Requisition.FindSet() then
            repeat
                RequisitionQty.Add(Requisition."No.", Requisition.Quantity);
                RequisitionReleased.Add(Requisition."No.", Requisition.Status = Requisition.Status::Released);
            until Requisition.Next() = 0;

        if Vendor.FindSet() then
            repeat
                VendorName.Add(Vendor."No.", Vendor.Name);
                VendorTermsCode.Add(Vendor."No.", Vendor."Terms Code");
            until Vendor.Next() = 0;

        if Terms.FindSet() then
            repeat
                TermsDiscount.Add(Terms."Code", Terms."Discount Pct");
            until Terms.Next() = 0;

        if PostingLine.FindSet() then
            repeat
                if RequisitionReleased.ContainsKey(PostingLine."Requisition No.") then
                    if RequisitionReleased.Get(PostingLine."Requisition No.") then
                        if not (BlockList.IsBlocked(PostingLine."Vendor No.") or BlockList.IsBlocked(PostingLine."Item No.")) then begin
                            Clear(OrderLine);
                            OrderLine."Item No." := PostingLine."Item No.";
                            OrderLine.Quantity := RequisitionQty.Get(PostingLine."Requisition No.");
                            if Fulfillment.CanFulfill(OrderLine) then
                                if VendorName.ContainsKey(PostingLine."Vendor No.") then begin
                                    DiscountPct := 0;
                                    TermsCode := VendorTermsCode.Get(PostingLine."Vendor No.");
                                    if TermsDiscount.ContainsKey(TermsCode) then
                                        DiscountPct := TermsDiscount.Get(TermsCode);

                                    PostedPurchase.Init();
                                    PostedPurchase."Requisition No." := PostingLine."Requisition No.";
                                    PostedPurchase."Vendor No." := PostingLine."Vendor No.";
                                    PostedPurchase."Vendor Name" := VendorName.Get(PostingLine."Vendor No.");
                                    PostedPurchase.Quantity := RequisitionQty.Get(PostingLine."Requisition No.");
                                    PostedPurchase."Unit Cost" := PostingLine."Unit Cost";
                                    PostedPurchase."Discount Pct" := DiscountPct;
                                    PostedPurchase."Net Amount" := RequisitionQty.Get(PostingLine."Requisition No.") * PostingLine."Unit Cost" * (1 - DiscountPct / 100);
                                    PostedPurchase.Insert();
                                end;
                        end;
            until PostingLine.Next() = 0;
    end;
}

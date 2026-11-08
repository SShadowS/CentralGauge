codeunit 70351 "CGR Lease Rate Review Unit"
{
    TableNo = "CGR Lease Contract";

    trigger OnRun()
    var
        LeaseRateReview: Codeunit "CGR Lease Rate Review";
    begin
        LeaseRateReview.ReviewLease(Rec."No.");
    end;
}

codeunit 87507 "HX103 Review Runner"
{
    var
        LeaseNoFilter: Text;
        ReviewResult: Integer;

    procedure HX103SetLeases(NewLeaseNoFilter: Text)
    begin
        LeaseNoFilter := NewLeaseNoFilter;
    end;

    procedure HX103Result(): Integer
    begin
        exit(ReviewResult);
    end;

    trigger OnRun()
    var
        LeaseFilter: Record "CGR Lease Contract";
        LeaseRateReview: Codeunit "CGR Lease Rate Review";
    begin
        ReviewResult := -1;
        LeaseFilter.SetFilter("No.", LeaseNoFilter);
        ReviewResult := LeaseRateReview.ReviewLeaseRates(LeaseFilter);
    end;
}

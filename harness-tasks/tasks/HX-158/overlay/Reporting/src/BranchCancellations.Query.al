query 70534 "CGR Branch Cancellations"
{
    QueryType = Normal;

    elements
    {
        dataitem(Entry; "CGR Cancellation Entry")
        {
            column(BranchCode; "Branch Code") { }
            column(FeeTotal; "Fee Amount") { Method = Sum; }
            column(Cancellations) { Method = Count; }
        }
    }
}

query 70534 "CGR Branch Cancellations"
{
    QueryType = Normal;

    elements
    {
        dataitem(Entry; "CGR Cancellation Entry")
        {
            DataItemTableFilter = Waived = const(false);

            column(BranchCode; "Branch Code") { }
            column(FeeTotal; "Fee Amount") { Method = Sum; }
            column(Cancellations) { Method = Count; }
        }
    }
}

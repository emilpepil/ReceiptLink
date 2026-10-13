// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Single-payment invoices. Settlement goes directly from buyer to seller.
contract ReceiptLink is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { Unknown, Open, Paid, Cancelled }
    struct Invoice {
        address seller;
        uint256 amount;
        bytes32 metadataHash;
        Status status;
        address payer;
        uint64 paidAt;
    }

    IERC20 public immutable paymentToken;
    mapping(bytes32 => Invoice) private invoices;

    error InvoiceAlreadyExists();
    error InvoiceNotOpen();
    error InvalidInvoice();
    error Unauthorized();

    event InvoiceCreated(bytes32 indexed id, address indexed seller, uint256 amount, bytes32 metadataHash);
    event Paid(bytes32 indexed id, address indexed payer, address indexed seller, uint256 amount);
    event InvoiceCancelled(bytes32 indexed id);

    constructor(address token) {
        if (token == address(0) || token.code.length == 0) revert InvalidInvoice();
        paymentToken = IERC20(token);
    }

    function createInvoice(bytes32 id, uint256 amount, bytes32 metadataHash) external {
        if (id == bytes32(0) || amount == 0 || metadataHash == bytes32(0)) revert InvalidInvoice();
        if (invoices[id].status != Status.Unknown) revert InvoiceAlreadyExists();
        invoices[id] = Invoice(msg.sender, amount, metadataHash, Status.Open, address(0), 0);
        emit InvoiceCreated(id, msg.sender, amount, metadataHash);
    }

    function pay(bytes32 id) external nonReentrant {
        Invoice storage invoice = invoices[id];
        if (invoice.status != Status.Open) revert InvoiceNotOpen();
        invoice.status = Status.Paid;
        invoice.payer = msg.sender;
        invoice.paidAt = uint64(block.timestamp);
        paymentToken.safeTransferFrom(msg.sender, invoice.seller, invoice.amount);
        emit Paid(id, msg.sender, invoice.seller, invoice.amount);
    }

    function cancelInvoice(bytes32 id) external {
        Invoice storage invoice = invoices[id];
        if (invoice.seller != msg.sender) revert Unauthorized();
        if (invoice.status != Status.Open) revert InvoiceNotOpen();
        invoice.status = Status.Cancelled;
        emit InvoiceCancelled(id);
    }

    function getInvoice(bytes32 id) external view returns (Invoice memory) {
        return invoices[id];
    }
}
